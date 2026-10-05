import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { toHex } from "viem";
import { rewardAllocationCommitment,rewardCampaignAbi,encodeRewardLifecycle,readVerifiedRewardLifecycle } from "../dist/index.js";
import { h,proposalFor } from "../test/fixtures.mjs";
import { startOwnedRewardChain } from "./owned-chain.mjs";
import { lifecycleWorkerFixture } from "./lifecycle-worker-cases.mjs";

let chain;
const finalize=()=>chain.testClient.mine({blocks:96,interval:1});
async function receipt(hash,status="success"){
  const r=await chain.publicClient.waitForTransactionReceipt({hash,timeout:10000});assert.equal(r.status,status);return r;
}
async function fixture(label) {
  const {operatorClient,operator,treasury,publicClient,artifact}=chain;const base=proposalFor();
  const upload=rewardAllocationCommitment({...base,campaignId:h(label),budget:100n,latestPublicationAt:1700000000n,
    awards:[{entitlementId:toHex(1n,{size:32}),beneficiaryId:h(`${label}-athlete`),pot:0,amount:40n,explanationHash:h(`${label}-reason`),beneficiaryKind:0}]});
  const deployed=await receipt(await operatorClient.deployContract({abi:rewardCampaignAbi,bytecode:artifact.bytecode.object,
    args:[operator.address,treasury,upload.programmeId,upload.campaignId,upload.programmeManifestHash,0]}));
  const tx=await publicClient.getTransaction({hash:deployed.transactionHash});
  const deployment={context:{environment:"local-simulation",chainId:31337,verifyingContract:deployed.contractAddress},operatorAddress:operator.address,treasuryAddress:treasury,
    programmeId:upload.programmeId,campaignId:upload.campaignId,programmeManifestHash:upload.programmeManifestHash,enabledPot:0,
    deploymentNonce:BigInt(tx.nonce),deploymentTransactionHash:deployed.transactionHash};
  await receipt(await operatorClient.writeContract({address:deployed.contractAddress,abi:rewardCampaignAbi,functionName:"completeFunding",args:[0n,100n],value:100n}));
  await finalize();return{deployment,upload};
}
before(async()=>{chain=await startOwnedRewardChain();},{timeout:20000});
after(async()=>{await chain?.stop();});

test("lifecycle worker fails closed on ambiguous RPC, malformed observations, nonce mismatch and changed authority",async()=>{
  const f=await fixture("worker-negative");const w=await lifecycleWorkerFixture(chain,f);const client=chain.publicClient;
  assert.equal((await w.run({...client,getChainId:async()=>143})).outcome,"unavailable");
  assert.equal((await w.run({...client,getTransaction:async()=>{throw new Error("synthetic private RPC detail");}})).outcome,"unavailable");
  for(const tx of [undefined,null,{}, {hash:w.hash,from:null}])assert.equal((await w.run({...client,getTransaction:async()=>tx})).outcome,"requires_attention");
  assert.equal((await w.run({...client,getTransactionCount:async()=>Number(w.plan.nonce)-1})).outcome,"awaiting_nonce");
  assert.equal((await w.run({...client,getTransactionCount:async()=>Number(w.plan.nonce)+1})).outcome,"nonce_conflict");
  assert.equal((await w.run({...client,getTransactionCount:async()=>0.5})).outcome,"unavailable");
  assert.equal((await w.run({...client,getCode:async()=>"0x00"})).outcome,"unavailable");
  for(const error of ["reward_lifecycle_job_lease_lost","reward_operator_permission_required","reward_lifecycle_predecessor_mismatch"]){
    w.setArmError(error);await assert.rejects(w.run(),{code:error});
  }
  w.setArmError("reward_record_approval_withdrawn");assert.equal((await w.run()).outcome,"evidence_changed");
  w.setArmError("reward_lifecycle_review_not_finished");assert.equal((await w.run()).outcome,"review_not_finished");
  assert.deepEqual(w.stats(),{sent:0,armed:0,confirmations:0});
});

test("lifecycle worker cannot start a send after its returned lease deadline",async()=>{
  const f=await fixture("worker-expired-arm");const w=await lifecycleWorkerFixture(chain,f);
  w.expireArm(true);assert.equal((await w.run()).outcome,"busy");assert.deepEqual(w.stats(),{sent:0,armed:1,confirmations:0});
});

test("lifecycle worker refuses a changed prefix and records an already-mined revert without a replacement send",async()=>{
  const f=await fixture("worker-changed-prefix");const w=await lifecycleWorkerFixture(chain,f,{nonceOffset:1n});
  // Explicit synthetic external action reproduces a conflicting write outside
  // the worker. The worker does not create replacements or change signed bytes.
  await receipt(await chain.operatorClient.sendTransaction({...encodeRewardLifecycle({...w.plan,nonce:w.plan.nonce-1n}),gas:5000000n}));
  await finalize();assert.equal((await w.run()).outcome,"prestate_changed");
  await receipt(await chain.operatorClient.sendRawTransaction({serializedTransaction:w.signed}),"reverted");await finalize();
  assert.equal((await w.run()).outcome,"requires_attention");assert.deepEqual(w.stats(),{sent:0,armed:0,confirmations:0});
});

test("pending lifecycle identity is checked and mined history remains reconcilable after evidence withdrawal",async()=>{
  const f=await fixture("worker-pending-history");const w=await lifecycleWorkerFixture(chain,f);const client=chain.publicClient;
  await chain.testClient.setAutomine(false);
  try{
    assert.equal((await w.run()).outcome,"submitted");
    const tx=await client.getTransaction({hash:w.hash});assert.equal(tx.blockNumber,null);
    for(const mutate of [t=>{t.to=chain.treasury;},t=>{t.input+="00";},t=>{t.nonce++;},t=>{t.value=1n;},t=>{t.chainId=143;},
      t=>{t.accessList=[{address:chain.treasury,storageKeys:[]}];},t=>{t.blockHash=h("pending-mismatch");}]){
      const changed=structuredClone(tx);mutate(changed);assert.equal((await w.run({...client,getTransaction:async()=>changed})).outcome,"requires_attention");
    }
    w.setArmError("reward_record_approval_withdrawn");
    assert.equal((await w.run()).outcome,"pending");assert.deepEqual(w.stats(),{sent:1,armed:1,confirmations:0});
  }finally{await chain.testClient.setAutomine(true);}
  await receipt(w.hash);await finalize();assert.equal((await w.run()).outcome,"confirmed");
  assert.equal((await w.run()).outcome,"confirmed");assert.deepEqual(w.stats(),{sent:1,armed:1,confirmations:1});
});

test("activation worker rechecks the chain review clock before arming an otherwise-ready stored intent",async()=>{
  const f=await fixture("worker-activation-clock");const upload=await lifecycleWorkerFixture(chain,f);
  assert.equal((await upload.run()).outcome,"submitted");await receipt(upload.hash);await finalize();assert.equal((await upload.run()).outcome,"confirmed");
  const stage=await lifecycleWorkerFixture(chain,f,{action:"stage_allocation"});assert.equal((await stage.run()).outcome,"submitted");
  await receipt(stage.hash);await finalize();assert.equal((await stage.run()).outcome,"confirmed");
  const proof=await readVerifiedRewardLifecycle(chain.publicClient,stage.plan,stage.signed,chain.artifact.bytecode.object);
  const beforeReady=await chain.testClient.snapshot();
  await chain.testClient.setNextBlockTimestamp({timestamp:proof.lifecycle.activationNotBefore});await finalize();
  const activation=await lifecycleWorkerFixture(chain,f,{action:"activate"});
  // Preserve a ready private intent while simulating the chain returning to its
  // earlier staged state; fresh chain reads, not the old intent, gate the send.
  await chain.testClient.revert({id:beforeReady});
  assert.equal((await activation.run()).outcome,"review_not_finished");assert.deepEqual(activation.stats(),{sent:0,armed:0,confirmations:0});
  await chain.testClient.setNextBlockTimestamp({timestamp:proof.lifecycle.activationNotBefore});await finalize();
  assert.equal((await activation.run()).outcome,"submitted");await receipt(activation.hash);await finalize();
  assert.equal((await activation.run()).outcome,"confirmed");assert.deepEqual(activation.stats(),{sent:1,armed:1,confirmations:1});
});
