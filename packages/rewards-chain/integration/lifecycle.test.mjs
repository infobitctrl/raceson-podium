import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { toHex } from "viem";
import { encodeRewardLifecycle,readVerifiedRewardLifecycle,readVerifiedRewardCampaign,requireRewardLifecyclePrestate,verifySignedRewardLifecycle,
  rewardLifecycleFromObservation,rewardAllocationCommitment,rewardCampaignAbi } from "../dist/index.js";
import { h,proposalFor } from "../test/fixtures.mjs";
import { startOwnedRewardChain } from "./owned-chain.mjs";

let chain,main,firstUpload,staged,activated;
const code=expected=>error=>error.code===expected;
const finalize=()=>chain.testClient.mine({blocks:96,interval:1});
async function receipt(hash,status="success"){const r=await chain.publicClient.waitForTransactionReceipt({hash,timeout:10000});assert.equal(r.status,status);return r;}
async function fixture(label,{recent=false,empty=false,fullBatch=false}={}) {
  const {publicClient,operatorClient,operator,treasury,artifact}=chain;const base=proposalFor();const block=await publicClient.getBlock({blockTag:"latest"});
  const awards=fullBatch?Array.from({length:64},(_,i)=>({entitlementId:toHex(BigInt(i+1),{size:32}),beneficiaryId:h(`${label}-beneficiary-${i}`),
    pot:0,amount:1n,explanationHash:h(`${label}-explanation-${i}`),beneficiaryKind:i%2})):empty?[]:base.awards;
  const upload=rewardAllocationCommitment({...base,campaignId:h(label),budget:base.budgets[0],awards,
    latestPublicationAt:recent?block.timestamp-10n:base.latestPublicationAt});
  const deployed=await receipt(await operatorClient.deployContract({abi:rewardCampaignAbi,bytecode:artifact.bytecode.object,
    args:[operator.address,treasury,upload.programmeId,upload.campaignId,upload.programmeManifestHash,upload.enabledPot]}));
  const tx=await publicClient.getTransaction({hash:deployed.transactionHash});
  const deployment={context:{environment:"local-simulation",chainId:31337,verifyingContract:deployed.contractAddress},operatorAddress:operator.address,
    treasuryAddress:treasury,programmeId:upload.programmeId,campaignId:upload.campaignId,programmeManifestHash:upload.programmeManifestHash,
    enabledPot:upload.enabledPot,deploymentNonce:BigInt(tx.nonce),deploymentTransactionHash:deployed.transactionHash};
  await receipt(await operatorClient.writeContract({address:deployed.contractAddress,abi:rewardCampaignAbi,functionName:"completeFunding",args:[0n,upload.budgets[0]],value:upload.budgets[0]}));
  await finalize();return{upload,deployment};
}
async function prepare(f,action,batchStart,batchSize) {
  const nonce=BigInt(await chain.publicClient.getTransactionCount({address:chain.operator.address,blockTag:"pending"}));
  const plan={...f,nonce,action,...(action==="upload_awards"?{batchStart,batchSize}:{})};
  const signed=await chain.operator.signTransaction({...encodeRewardLifecycle(plan),type:"eip1559",gas:batchSize===64?20000000n:5000000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
  const verified=await verifySignedRewardLifecycle(plan,signed);return{plan,signed,hash:verified.transactionHash};
}
const read=(entry,reader=chain.publicClient)=>readVerifiedRewardLifecycle(reader,entry.plan,entry.signed,chain.artifact.bytecode.object);
const current=f=>readVerifiedRewardCampaign(chain.publicClient,f.deployment,chain.artifact.bytecode.object);
async function execute(entry,status="success") {
  entry.receipt=await receipt(await chain.operatorClient.sendRawTransaction({serializedTransaction:entry.signed}),status);await finalize();
  return status==="success"?read(entry):null;
}
before(async()=>{chain=await startOwnedRewardChain();main=await fixture("lifecycle-main");},{timeout:20000});
after(async()=>{await chain?.stop();});

test("partial upload receipts prove exact ordered awards and the current approved prefix",async()=>{
  firstUpload=await prepare(main,"upload_awards",0,2);const before=await current(main);
  assert.equal(requireRewardLifecyclePrestate(firstUpload.plan,before.observation.accounting,before.observation.finalizedBlock.timestamp).completedAwards,0n);
  const proof=await execute(firstUpload);assert.equal(proof.lifecycle.batchStart,0);assert.equal(proof.lifecycle.batchSize,2);
  assert.equal(proof.checkpoint.observation.accounting.entitlementCount,2n);assert.deepEqual(proof.checkpoint.observation.accounting.paid,[0n,0n]);
  assert.equal(firstUpload.receipt.logs.length,2);
  assert.throws(()=>requireRewardLifecyclePrestate(firstUpload.plan,proof.checkpoint.observation.accounting,proof.checkpoint.observation.finalizedBlock.timestamp),code("reward_lifecycle_prefix_mismatch"));
  assert.deepEqual(await read(firstUpload),proof);
});
test("incomplete staging and duplicate batches fail; complete staging proves the 24-hour allocation clock",async()=>{
  const stage=await prepare(main,"stage_allocation");const before=await current(main);
  assert.throws(()=>requireRewardLifecyclePrestate(stage.plan,before.observation.accounting,before.observation.finalizedBlock.timestamp),code("reward_lifecycle_upload_incomplete"));
  const duplicate=await prepare(main,"upload_awards",0,2);await execute(duplicate,"reverted");await assert.rejects(read(duplicate),code("reward_lifecycle_reverted"));
  const remaining=await prepare(main,"upload_awards",2,main.upload.awards.length-2);await execute(remaining);
  staged=await prepare(main,"stage_allocation");const ready=await current(main);requireRewardLifecyclePrestate(staged.plan,ready.observation.accounting,ready.observation.finalizedBlock.timestamp);
  const proof=await execute(staged);assert.equal(proof.lifecycle.activationNotBefore,proof.lifecycle.blockTimestamp+86400n);
  assert.equal(proof.checkpoint.observation.accounting.allocationDigest,main.upload.allocationDigest);assert.equal(proof.checkpoint.observation.accounting.state,2);
});
test("early activation reverts, then exact successful activation proves its initial 365-day deadline",async()=>{
  const early=await prepare(main,"activate");const before=await current(main);
  assert.throws(()=>requireRewardLifecyclePrestate(early.plan,before.observation.accounting,before.observation.finalizedBlock.timestamp),code("reward_lifecycle_review_not_finished"));
  await execute(early,"reverted");await assert.rejects(read(early),code("reward_lifecycle_reverted"));
  await chain.testClient.setNextBlockTimestamp({timestamp:before.observation.accounting.activationNotBefore});await finalize();
  activated=await prepare(main,"activate");const ready=await current(main);requireRewardLifecyclePrestate(activated.plan,ready.observation.accounting,ready.observation.finalizedBlock.timestamp);
  const proof=await execute(activated);assert.equal(proof.lifecycle.claimDeadline,proof.lifecycle.blockTimestamp+31536000n);
  assert.equal(proof.checkpoint.observation.accounting.claimDeadline,proof.lifecycle.claimDeadline);assert.equal(proof.checkpoint.observation.accounting.state,3);
  assert.equal((await read(firstUpload)).checkpoint.observation.accounting.state,3,"Historical upload remains provable after activation");
  assert.equal((await read(staged)).lifecycle.allocationDigest,main.upload.allocationDigest);
});
test("lifecycle receipts reject changed identity, full event encoding, order, clocks and canonical provenance",async()=>{
  for(const entry of [firstUpload,staged,activated]) {
    const block=await chain.publicClient.getBlock({blockNumber:entry.receipt.blockNumber});const finalized=await chain.publicClient.getBlock({blockTag:"finalized"});
    const observed={observedChainId:31337,transaction:await chain.publicClient.getTransaction({hash:entry.hash}),receipt:entry.receipt,
      canonicalActionBlock:{number:block.number,hash:block.hash,timestamp:block.timestamp},finalizedBlock:{number:finalized.number,hash:finalized.hash,timestamp:finalized.timestamp},
      runtimeCode:await chain.publicClient.getCode({address:main.deployment.context.verifyingContract,blockNumber:finalized.number})};
    assert.equal(rewardLifecycleFromObservation(entry.plan,entry.hash,observed).transactionHash,entry.hash);
    for(const mutate of [o=>{o.transaction.to=chain.treasury;},o=>{o.transaction.value=1n;},o=>{o.transaction.nonce++;},o=>{o.transaction.hash=h("other");},
      o=>{o.receipt.status="reverted";},o=>{o.receipt.logs[0].data+="00";},o=>{o.receipt.logs[0].topics.push(h("extra"));},o=>{o.receipt.logs[0].removed=true;},
      o=>{o.receipt.logs[0].transactionHash=h("other");},o=>{o.receipt.logs[0].logIndex=-1;},o=>{o.receipt.logs.pop();},o=>{o.receipt.logs.push(o.receipt.logs[0]);},
      o=>{o.finalizedBlock.number=entry.receipt.blockNumber-1n;},o=>{o.canonicalActionBlock.hash=h("reorg");},o=>{o.observedChainId=143;},o=>{o.runtimeCode="0x00";}]) {
      const copy=structuredClone(observed);mutate(copy);assert.throws(()=>rewardLifecycleFromObservation(entry.plan,entry.hash,copy));
    }
    if(entry!==firstUpload) {
      const copy=structuredClone(observed);copy.canonicalActionBlock.timestamp++;assert.throws(()=>rewardLifecycleFromObservation(entry.plan,entry.hash,copy),code("reward_lifecycle_event_mismatch"));
    } else {
      const copy=structuredClone(observed);copy.receipt.logs.reverse();assert.throws(()=>rewardLifecycleFromObservation(entry.plan,entry.hash,copy));
    }
  }
});
test("lifecycle readers detect chain drift and reject unavailable or contradictory current accounting",async()=>{
  let actionReads=0;const client=chain.publicClient;
  await assert.rejects(read(staged,{...client,getBlock:async args=>{const block=await client.getBlock(args);
    return args.blockNumber===staged.receipt.blockNumber && ++actionReads===2?{...block,hash:h("drift")}:block;}}),code("reward_chain_changed_during_observation"));
  await assert.rejects(read(activated,{...client,getTransactionReceipt:async args=>{if(args.hash===activated.hash)throw new Error("synthetic private provider detail");return client.getTransactionReceipt(args);}}),
    e=>e.code==="reward_lifecycle_observation_unavailable" && e.cause===undefined && !String(e).includes("provider"));
  await assert.rejects(read(firstUpload,{...client,readContract:async args=>args.functionName==="uploadDigest"?h("wrong prefix"):client.readContract(args)}),code("reward_lifecycle_prefix_mismatch"));
  assert.deepEqual((await read(activated)).checkpoint.observation.accounting.paid,[0n,0n]);
});
test("a recent publication makes the 72-hour source clock later than the allocation clock",async()=>{
  const f=await fixture("recent-correction-clock",{recent:true});await execute(await prepare(f,"upload_awards",0,f.upload.awards.length));
  const entry=await prepare(f,"stage_allocation");const proof=await execute(entry);
  assert.equal(proof.lifecycle.activationNotBefore,f.upload.latestPublicationAt+259200n);
  assert(proof.lifecycle.activationNotBefore>proof.lifecycle.blockTimestamp+86400n);
  await chain.testClient.setNextBlockTimestamp({timestamp:proof.lifecycle.blockTimestamp+86400n+1n});await finalize();
  const early=await prepare(f,"activate");const notReady=await current(f);
  assert.throws(()=>requireRewardLifecyclePrestate(early.plan,notReady.observation.accounting,notReady.observation.finalizedBlock.timestamp),code("reward_lifecycle_review_not_finished"));
  await execute(early,"reverted");
  await chain.testClient.setNextBlockTimestamp({timestamp:proof.lifecycle.activationNotBefore});await finalize();
  const activated=await execute(await prepare(f,"activate"));assert.equal(activated.checkpoint.observation.accounting.state,3);
});
test("an empty approved allocation can stage and activate while every wei remains unallocated",async()=>{
  const f=await fixture("empty-reserve",{empty:true});const stage=await prepare(f,"stage_allocation");const state=await current(f);
  requireRewardLifecyclePrestate(stage.plan,state.observation.accounting,state.observation.finalizedBlock.timestamp);
  const staged=await execute(stage);assert.equal(staged.checkpoint.observation.accounting.entitlementCount,0n);
  await chain.testClient.setNextBlockTimestamp({timestamp:staged.lifecycle.activationNotBefore});await finalize();
  const active=await execute(await prepare(f,"activate"));assert.deepEqual(active.checkpoint.observation.accounting.allocated,[0n,0n]);
  assert.equal(active.checkpoint.observation.accounting.nativeBalance,f.upload.budgets[0]);
});

test("a real maximum-size batch verifies all 64 events and its exact unclaimed allocation",async()=>{
  const f=await fixture("maximum-batch",{fullBatch:true});const entry=await prepare(f,"upload_awards",0,64);
  const proof=await execute(entry);assert.equal(entry.receipt.logs.length,64);assert.equal(proof.lifecycle.batchSize,64);
  assert.equal(proof.checkpoint.observation.accounting.entitlementCount,64n);assert.deepEqual(proof.checkpoint.observation.accounting.allocated,[64n,0n]);
  assert.deepEqual(proof.checkpoint.observation.accounting.paid,[0n,0n]);
});
