import assert from "node:assert/strict";
import { test } from "node:test";
import { readRewardCampaignCheckpoint, storeRewardCampaignCheckpoint, decodeRewardCampaignObservation, decodeRewardCampaignDeployment } from "../../../packages/db/dist/rewards/index.js";
import { rewardCampaignBuild } from "../../../packages/rewards-chain/dist/index.js";
const id=n=>`77000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=n=>`0x${String(n).repeat(64)}`; const zero=hash(0);
function fixture(){
  const input={campaignId:id(1),actorUserId:id(2),intentId:id(3),attemptId:id(4),idempotencyKey:"checkpoint-unit-01",
    deployment:{schemaVersion:1,chainId:31337,contractAddress:`0x${'1'.repeat(40)}`,buildId:rewardCampaignBuild.id,
      creationCodeHash:rewardCampaignBuild.creationCodeHash,runtimeCodeHash:hash(2),deploymentTransactionHash:hash(3),deploymentNonce:"7",
      deploymentBlockNumber:"100",deploymentBlockHash:hash(4)},
    observation:{schemaVersion:1,finalizedBlock:{number:"200",hash:hash(5),timestamp:"1800000200"},accounting:{state:0,paused:false,accountedFunding:"0",
      treasuryReturned:"0",budgets:["0","0"],allocated:["0","0"],paid:["0","0"],nativeBalance:"100",entitlementCount:"0",
      uploadDigest:zero,snapshotDigest:zero,allocationDigest:zero,activationNotBefore:"0",claimDeadline:"0",pausedAt:"0"}}};
  const result={campaignId:id(1),intentId:id(3),attemptId:id(4),deployment:structuredClone(input.deployment),observation:structuredClone(input.observation),
    observationId:id(5),observedByUserId:id(2),observedAt:"2026-09-08T03:00:00Z",idempotencyKey:input.idempotencyKey};
  return{input,result};
}
test("checkpoint repository accepts no-history and strictly decodes exact private persisted observations",async()=>{
  const{input,result}=fixture();
  assert.equal(await readRewardCampaignCheckpoint(input,async(name,args)=>{
    assert.equal(name,"service_read_reward_campaign_checkpoint"); assert.equal(args.p_actor_user_id,id(2)); return{data:null,error:null};}),null);
  const saved=await storeRewardCampaignCheckpoint(input,async(name,args)=>{
    assert.equal(name,"service_record_reward_campaign_checkpoint"); assert.deepEqual(args.p_deployment,input.deployment); assert.deepEqual(args.p_observation,input.observation);
    return{data:result,error:null};});
  assert.equal(saved.deployment.deploymentNonce,7n); assert.equal(saved.observation.finalizedBlock.number,200n);
  assert.equal(saved.observation.accounting.nativeBalance,100n); assert.equal(saved.observation.accounting.accountedFunding,0n);
  assert.doesNotMatch(JSON.stringify(result),/signedTransaction|privateKey|athleteId/);
});
test("checkpoint request scope and bodies are copied before async persistence",async()=>{
  const{input,result}=fixture(); let captured;
  const saved=await storeRewardCampaignCheckpoint(input,async(_name,args)=>{
    captured=args; input.campaignId=id(99); input.actorUserId=id(99); input.observation.accounting.nativeBalance="999";
    await Promise.resolve(); return{data:result,error:null};});
  assert.equal(saved.campaignId,id(1)); assert.equal(captured.p_campaign_id,id(1)); assert.equal(captured.p_actor_user_id,id(2));
  assert.equal(captured.p_observation.accounting.nativeBalance,"100");
});
test("checkpoint decoders reject scope substitution, unknown data, accessors and lossy numbers",async()=>{
  for(const mutate of [r=>{r.campaignId=id(99);},r=>{r.intentId="invalid";},r=>{r.observedByUserId=id(99);},r=>{r.idempotencyKey="wrong-key";},
    r=>{r.deployment.chainId=143;},r=>{r.deployment.deploymentNonce="9007199254740992";},r=>{r.observation.accounting.accountedFunding=100;},
    r=>{r.observation.accounting.budgets=["0",,"0"];},r=>{r.observation.finalizedBlock.number="99";},
    r=>{r.observation.finalizedBlock.number="100";},r=>{r.extra="private user data";},r=>{r.observation.accounting.extra="private data";}]){
    const{input,result}=fixture(); mutate(result); await assert.rejects(readRewardCampaignCheckpoint(input,async()=>({data:result,error:null})));
  }
  const{input}=fixture(); let invoked=0;
  Object.defineProperty(input.observation.accounting,"nativeBalance",{enumerable:true,get(){invoked++;return"100";}});
  assert.throws(()=>decodeRewardCampaignObservation(input.observation)); assert.equal(invoked,0);
  await assert.rejects(storeRewardCampaignCheckpoint(input,async()=>{assert.fail("Accessor input must not reach persistence");})); assert.equal(invoked,0);
  assert.throws(()=>decodeRewardCampaignDeployment({...fixture().input.deployment,deploymentBlockNumber:"1.1"}));
});
test("save replies must bind exact attempted witness rather than just valid-looking metadata",async()=>{
  for(const mutate of [r=>{r.attemptId=id(99);},r=>{r.deployment.runtimeCodeHash=hash(9);},r=>{r.observation.accounting.nativeBalance="101";}]){
    const{input,result}=fixture(); mutate(result);
    await assert.rejects(storeRewardCampaignCheckpoint(input,async()=>({data:result,error:null})),{code:"invalid_reward_campaign_checkpoint"});
  }
});
test("checkpoint transport errors retain only allowlisted safe codes",async()=>{
  const{input}=fixture();
  await assert.rejects(storeRewardCampaignCheckpoint(input,async()=>({data:null,error:{message:"reward_operator_permission_required"}})),{code:"reward_operator_permission_required"});
  await assert.rejects(readRewardCampaignCheckpoint(input,async()=>({data:null,error:{message:"credential-bearing SQL message"}})),
    e=>e.code==="reward_ledger_store_failed" && !e.stack.includes("credential-bearing") && e.cause===undefined);
  await assert.rejects(readRewardCampaignCheckpoint(input,async()=>{throw new Error("credential-bearing endpoint");}),
    e=>e.code==="reward_ledger_unavailable" && !e.stack.includes("credential-bearing") && e.cause===undefined);
});
