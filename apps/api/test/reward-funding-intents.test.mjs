import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, keccak256, serializeTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readRewardFundingContext, reserveRewardFundingIntent, storeRewardFundingAttempt, readRewardFundingAttempt } from "../../../packages/db/dist/rewards/index.js";
import { encodeRewardFunding, rewardCampaignBuild } from "../../../packages/rewards-chain/dist/index.js";
import { prepareRewardFunding, recordSignedRewardFunding, loadVerifiedRewardFundingAttempt } from "../dist/features/rewards/funding-service.js";
import { calculationFixture, rewardId as id, rewardWire } from "./fixtures/reward-calculation.mjs";

// Entirely synthetic SQL-shaped evidence; not an actual deployment/checkpoint.
const operator=privateKeyToAccount(toHex(0xA11CEn,{size:32}));
const stranger=privateKeyToAccount(toHex(0xB0Bn,{size:32}));
const hash=(n)=>toHex(BigInt(n),{size:32});
const zero=hash(0); const code=expected=>error=>error.code===expected;
function fixture() {
  const session=calculationFixture().session; const actorUserId=session.account.userId; const campaignId=id(801); const intentId=id(804);
  const address=getContractAddress({from:operator.address,nonce:0n}).toLowerCase();
  const deploymentContext={schemaVersion:1,programmeId:id(800),campaignId,environment:'local_simulation',chainId:31337,
    operatorAddress:operator.address.toLowerCase(),treasuryAddress:stranger.address.toLowerCase(),programmeOnChainId:hash(1),campaignOnChainId:hash(2),manifestHash:hash(3),pot:'race',budgetWei:'12',
    intent:{id:id(802),nonce:'0',buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,
      createdByUserId:actorUserId,createdAt:'2026-09-08T01:00:00Z',idempotencyKey:'deployment-test-01'}};
  const checkpoint={campaignId,intentId:id(802),attemptId:id(803),deployment:{schemaVersion:1,chainId:31337,contractAddress:address,
    buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,runtimeCodeHash:hash(4),deploymentTransactionHash:hash(5),deploymentNonce:'0',deploymentBlockNumber:'100',deploymentBlockHash:hash(6)},
    observationId:id(809),observation:{schemaVersion:1,finalizedBlock:{number:'200',hash:hash(7),timestamp:'1800000000'},
      accounting:{state:0,paused:false,accountedFunding:'3',treasuryReturned:'0',budgets:['0','0'],allocated:['0','0'],paid:['0','0'],nativeBalance:'100',
        entitlementCount:'0',uploadDigest:zero,snapshotDigest:zero,allocationDigest:zero,activationNotBefore:'0',claimDeadline:'0',pausedAt:'0'}},
    observedByUserId:actorUserId,observedAt:'2026-09-08T01:00:01Z',idempotencyKey:'checkpoint-test-01'};
  const context={deploymentContext,checkpoint,intent:{id:intentId,observationId:checkpoint.observationId,nonce:'6',expectedAccountedFunding:'3',expectedBudget:'12',
    createdByUserId:actorUserId,createdAt:'2026-09-08T01:00:02Z',idempotencyKey:'funding-test-01'}};
  const input={campaignId,idempotencyKey:'funding-test-01'}; const scope={campaignId,actorUserId,intentId}; const calls=[];
  let stored; let corrupt=body=>body;
  const metadata=transactionHash=>({attemptId:id(805),intentId,campaignId,recordedByUserId:actorUserId,recordedAt:'2026-09-08T01:00:03Z',transactionHash});
  const rpc=async(name,args)=>{
    calls.push({name,args:structuredClone(args)});
    if(name==='service_read_reward_funding_context'||name==='service_reserve_reward_funding')return{data:structuredClone(context),error:null};
    if(name==='service_record_reward_funding_attempt'){stored=structuredClone(args.p_attempt);return{data:metadata(stored.transactionHash),error:null};}
    if(name==='service_read_reward_funding_attempt')return{data:{context:structuredClone(context),attempt:{id:id(805),intentId,body:corrupt(structuredClone(stored)),
      recordedByUserId:actorUserId,recordedAt:'2026-09-08T01:00:03Z',idempotencyKey:'signed-funding-test'}},error:null};
    assert.fail(`Unexpected ${name}`);
  };
  const prepare=()=>prepareRewardFunding(session,input,{rpc,reader:{},creationCode:'0x00'});
  const sign=async()=>operator.signTransaction({...encodeRewardFunding((await prepare()).plan),type:'eip1559',gas:300000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
  return{session,actorUserId,campaignId,intentId,context,input,scope,calls,rpc,prepare,sign,setCorrupt:fn=>{corrupt=fn;}};
}

test('funding preparation replays the original private plan without treating it as a fresh observation',async()=>{
  const f=fixture(); const first=await f.prepare(); assert.equal(first.reused,true); assert.equal(first.plan.nonce,6n);
  assert.equal(first.plan.expectedAccountedFunding,3n); assert.equal(first.plan.expectedBudget,12n); assert.equal(encodeRewardFunding(first.plan).value,9n);
  assert.deepEqual(await f.prepare(),first); assert(f.calls.every(call=>call.name==='service_read_reward_funding_context'));
  await assert.rejects(prepareRewardFunding(f.session,{...f.input,idempotencyKey:'different-funding-key'},{rpc:f.rpc,reader:{},creationCode:'0x00'}),code('reward_funding_already_planned'));
});

test('funding context rejects foreign scope, lossy amounts, changed budget and disconnected checkpoint identity',async()=>{
  const f=fixture();
  for(const mutate of [c=>{c.extra=true;},c=>{c.intent.nonce=6;},c=>{c.intent.nonce='0';},c=>{c.intent.expectedBudget='13';},
    c=>{c.intent.expectedAccountedFunding='4';},c=>{c.intent.observationId=id(999);},c=>{c.intent.createdByUserId=id(999);},
    c=>{c.checkpoint.campaignId=id(999);},c=>{c.checkpoint.intentId=id(999);},c=>{c.checkpoint.deployment.creationCodeHash=hash(99);},
    c=>{c.checkpoint.observation.accounting.state=1;},c=>{c.checkpoint=null;},c=>{c.deploymentContext.chainId=143;}]){
    const copy=structuredClone(f.context); mutate(copy);
    await assert.rejects(readRewardFundingContext(f.scope,async()=>({data:copy,error:null})));
  }
});

test('reservation copies scope and sends no user-supplied budget or transaction calldata',async()=>{
  const f=fixture(); const input={...f.scope,idempotencyKey:f.input.idempotencyKey,observationId:id(809),observedChainId:31337,pendingNonce:2n};
  const result=await reserveRewardFundingIntent(input,async(name,args)=>{
    assert.equal(name,'service_reserve_reward_funding'); assert.equal(args.p_pending_nonce,'2'); assert.equal(args.p_actor_user_id,f.actorUserId);
    assert.doesNotMatch(JSON.stringify(args),/budget|calldata|signedTransaction/);
    input.campaignId=id(999); input.actorUserId=id(998); input.pendingNonce=999n;
    return{data:structuredClone(f.context),error:null};
  });
  assert.equal(result.deploymentContext.campaignId,f.campaignId); assert.equal(result.intent.nonce,6n);
});

test('the funding service stores a real verified signature, returns metadata and revalidates private worker reads',async()=>{
  const f=fixture(); const signedTransaction=await f.sign();
  const input={...f.input,intentId:f.intentId,idempotencyKey:'signed-funding-test',signedTransaction};
  const saved=await recordSignedRewardFunding(f.session,input,f.rpc);
  assert.equal(saved.transactionHash,keccak256(signedTransaction)); assert.doesNotMatch(JSON.stringify(saved),/signedTransaction|privateKey|calldata/);
  const loaded=await loadVerifiedRewardFundingAttempt(f.session,{...f.scope,attemptId:saved.attemptId},f.rpc);
  assert.equal(loaded.verified.signedTransaction,signedTransaction); assert.equal(loaded.verified.value,9n); assert.equal(loaded.plan.expectedBudget,12n);
  assert.deepEqual(await recordSignedRewardFunding(f.session,input,f.rpc),saved);
});

test('another signer and malformed/unsigned payloads never reach funding attempt storage',async()=>{
  const f=fixture(); const plan=(await f.prepare()).plan;
  const unsigned={...encodeRewardFunding(plan),type:'eip1559',gas:300000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n};
  for(const signedTransaction of ['0x02aa','0x01aa',serializeTransaction(unsigned),await stranger.signTransaction(unsigned)]){
    await assert.rejects(recordSignedRewardFunding(f.session,{...f.input,intentId:f.intentId,signedTransaction},f.rpc));
  }
  assert(!f.calls.some(call=>call.name==='service_record_reward_funding_attempt'));
});

test('a corrupted stored funding witness cannot become trusted worker bytes',async()=>{
  const f=fixture(); const signedTransaction=await f.sign();
  const saved=await recordSignedRewardFunding(f.session,{...f.input,intentId:f.intentId,signedTransaction,idempotencyKey:'signed-funding-test'},f.rpc);
  f.setCorrupt(body=>({...body,calldataHash:hash(99)}));
  await assert.rejects(loadVerifiedRewardFundingAttempt(f.session,{...f.scope,attemptId:saved.attemptId},f.rpc),code('reward_stored_funding_attempt_mismatch'));
  f.setCorrupt(body=>({...body,expectedBudget:'13',value:'10'}));
  await assert.rejects(readRewardFundingAttempt({...f.scope,attemptId:saved.attemptId},f.rpc),code('invalid_reward_funding_document'));
});

test('signature recording captures the actor and complete request before awaiting the context',async()=>{
  const f=fixture(); const signedTransaction=await f.sign(); const input={...f.input,intentId:f.intentId,signedTransaction,idempotencyKey:'signed-funding-test'};
  const rpc=async(name,args)=>{
    const result=await f.rpc(name,args);
    if(name==='service_read_reward_funding_context'){f.session.account.userId=id(998); input.campaignId=id(999); input.signedTransaction='0x02aa'; input.idempotencyKey='mutated-key';}
    return result;
  };
  const saved=await recordSignedRewardFunding(f.session,input,rpc); assert.equal(saved.recordedByUserId,f.actorUserId); assert.equal(saved.campaignId,f.campaignId);
  const write=f.calls.find(call=>call.name==='service_record_reward_funding_attempt'); assert.equal(write.args.p_idempotency_key,'signed-funding-test');
  assert.equal(write.args.p_attempt.signedTransaction,signedTransaction);
});

test('repository attempt writes reject malformed documents and inconsistent returned metadata',async()=>{
  const f=fixture(); const signedTransaction=await f.sign();
  await recordSignedRewardFunding(f.session,{...f.input,intentId:f.intentId,signedTransaction,idempotencyKey:'signed-funding-test'},f.rpc);
  const body=f.calls.find(call=>call.name==='service_record_reward_funding_attempt').args.p_attempt;
  for(const patch of [{value:'1'},{nonce:6},{extra:true},{gasLimit:'0'},{signedTransaction:`0x02${'aa'.repeat(1025)}`}]){
    await assert.rejects(storeRewardFundingAttempt({...f.scope,idempotencyKey:'invalid-attempt',attempt:{...body,...patch}},()=>assert.fail('must not write')));
  }
  await assert.rejects(storeRewardFundingAttempt({...f.scope,idempotencyKey:'metadata-test',attempt:body},async()=>({data:{attemptId:id(805),intentId:f.intentId,
    campaignId:id(999),recordedByUserId:f.actorUserId,recordedAt:'2026-09-08T01:00:03Z',transactionHash:body.transactionHash},error:null})),code('invalid_reward_funding_document'));
  assert.equal(rewardWire(body).value,'9');
});

test('funding reads/preparation fail closed on authority, missing deployment, old build and provider details',async()=>{
  const f=fixture();
  await assert.rejects(readRewardFundingContext(f.scope,async()=>({data:null,error:{message:'reward_operator_permission_required'}})),code('reward_operator_permission_required'));
  await assert.rejects(readRewardFundingContext(f.scope,async()=>({data:null,error:{message:'synthetic secret endpoint'}})),code('reward_ledger_store_failed'));
  await assert.rejects(readRewardFundingContext(f.scope,async()=>{throw new Error('synthetic token');}),code('reward_ledger_unavailable'));
  f.context.deploymentContext.intent.buildId='unsupported-old-build'; f.context.checkpoint.deployment.buildId='unsupported-old-build';
  await assert.rejects(f.prepare(),code('reward_funding_deployment_not_verified'));
  f.context.intent=null; f.context.checkpoint=null;
  await assert.rejects(f.prepare(),code('reward_funding_deployment_not_verified'));
});
