import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData,getContractAddress,serializeTransaction,toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeRewardLifecycle,normalizeRewardLifecyclePlan,requireRewardLifecyclePrestate,rewardAllocationCommitment,rewardCampaignAbi,
  rewardUploadDigest,verifySignedRewardLifecycle,readVerifiedRewardLifecycle } from "../dist/index.js";
import { h,proposalFor } from "./fixtures.mjs";

const operator=privateKeyToAccount(toHex(0xA11CEn,{size:32}));const stranger=privateKeyToAccount(toHex(0xB0Bn,{size:32}));
const zero=toHex(0n,{size:32});const code=expected=>error=>error.code===expected;
function plan(action="upload_awards") {
  const upload=proposalFor();
  return {deployment:{context:{environment:"local-simulation",chainId:31337,verifyingContract:getContractAddress({from:operator.address,nonce:0n})},
    operatorAddress:operator.address,treasuryAddress:stranger.address,programmeId:upload.programmeId,campaignId:upload.campaignId,programmeManifestHash:upload.programmeManifestHash,
    enabledPot:0,deploymentNonce:0n,deploymentTransactionHash:h("lifecycle deployment")},nonce:3n,upload,action,...(action==="upload_awards"?{batchStart:0,batchSize:2}:{})};
}
const signing=p=>({...encodeRewardLifecycle(p),type:"eip1559",gas:3000000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
function accounting(p,count=0,state=1) {
  const prefix=rewardUploadDigest(p.upload.awards.slice(0,count),0,p.upload.budgets[0]);const staged=state>=2;
  return {state,paused:false,accountedFunding:p.upload.budgets[0],treasuryReturned:0n,budgets:p.upload.budgets,allocated:[prefix.total,0n],paid:[0n,0n],
    nativeBalance:p.upload.budgets[0]+100n,entitlementCount:prefix.count,uploadDigest:prefix.digest,snapshotDigest:staged?p.upload.snapshotDigest:zero,
    allocationDigest:staged?p.upload.allocationDigest:zero,activationNotBefore:staged?p.upload.latestPublicationAt+259200n:0n,claimDeadline:0n,pausedAt:0n};
}

test("lifecycle encoder allows exactly upload, stage and activate with zero native value",()=>{
  for(const action of ["upload_awards","stage_allocation","activate"]) {
    const p=plan(action);const encoded=encodeRewardLifecycle(p);const decoded=decodeFunctionData({abi:rewardCampaignAbi,data:encoded.data});
    assert.equal(encoded.value,0n);assert.equal(encoded.nonce,3);assert.equal(encoded.chainId,31337);
    if(action==="upload_awards")assert.deepEqual(decoded,{functionName:"uploadAwards",args:[p.upload.awards.slice(0,2)]});
    if(action==="stage_allocation")assert.deepEqual(decoded,{functionName:"stageAllocation",args:[p.upload.snapshotDigest,p.upload.uploadDigest,p.upload.entitlementCount,p.upload.latestPublicationAt]});
    if(action==="activate")assert.deepEqual(decoded,{functionName:"activate",args:[p.upload.allocationDigest,p.upload.snapshotDigest]});
    const normalized=normalizeRewardLifecyclePlan(p);assert.deepEqual(normalized,p);assert.notEqual(normalized.upload.awards[0],p.upload.awards[0]);
  }
});
test("lifecycle plans reject altered packages, networks, nonce ranges and invalid upload slices",()=>{
  for(const mutate of [p=>{p.nonce=0n;},p=>{p.nonce=Number.MAX_SAFE_INTEGER;},p=>{p.deployment.context.chainId=143;},p=>{p.upload.allocationDigest=h("other");},
    p=>{p.upload.awards[0].amount++;},p=>{p.upload.budgets[1]=1n;},p=>{p.upload.allocated[0]++;},p=>{p.upload.entitlementCount++;},
    p=>{p.upload.unallocated++;},p=>{p.upload.programmeId=h("other");},p=>{p.batchStart=-1;},p=>{p.batchSize=0;},p=>{p.batchSize=65;},
    p=>{p.batchStart=p.upload.awards.length;},p=>{p.batchStart=0.5;},p=>{p.action="returnToTreasury";}]) {
    const p=plan();mutate(p);assert.throws(()=>encodeRewardLifecycle(p));
  }
  assert.throws(()=>encodeRewardLifecycle({...plan("activate"),batchStart:0}),code("invalid_reward_lifecycle_batch"));
});
test("partial upload requires the exact approved prefix and supports a smaller final batch",()=>{
  const p=plan();const a=accounting(p);assert.equal(requireRewardLifecyclePrestate(p,a,p.upload.latestPublicationAt).completedAwards,0n);
  const next={...p,batchStart:2,batchSize:p.upload.awards.length-2};const partial=accounting(next,2);
  assert.equal(requireRewardLifecyclePrestate(next,partial,p.upload.latestPublicationAt).completedAwards,2n);
  assert.throws(()=>requireRewardLifecyclePrestate(p,partial,p.upload.latestPublicationAt),code("reward_lifecycle_prefix_mismatch"));
  assert.throws(()=>requireRewardLifecyclePrestate(next,{...partial,uploadDigest:h("other prefix")},p.upload.latestPublicationAt),code("reward_lifecycle_prefix_mismatch"));
  assert.throws(()=>requireRewardLifecyclePrestate(next,{...partial,allocated:[partial.allocated[0]+1n,0n]},p.upload.latestPublicationAt),code("reward_lifecycle_prefix_mismatch"));
});
test("staging requires the full package while activation waits for publication and contract clocks",()=>{
  const p=plan("stage_allocation");const full=accounting(p,p.upload.awards.length);const now=p.upload.latestPublicationAt;
  assert.throws(()=>requireRewardLifecyclePrestate(p,accounting(p,1),now),code("reward_lifecycle_upload_incomplete"));
  assert.throws(()=>requireRewardLifecyclePrestate(p,full,now-1n),code("reward_lifecycle_publication_in_future"));
  assert.equal(requireRewardLifecyclePrestate(p,full,now).sourceReviewEndsAt,now+259200n);
  const active=plan("activate");const staged=accounting(active,active.upload.awards.length,2);staged.activationNotBefore=now+400000n;
  assert.throws(()=>requireRewardLifecyclePrestate(active,staged,now+399999n),code("reward_lifecycle_review_not_finished"));
  assert.equal(requireRewardLifecyclePrestate(active,staged,now+400000n).activationNotBefore,now+400000n);
  assert.throws(()=>requireRewardLifecyclePrestate(active,{...staged,snapshotDigest:h("other")},now+400000n),code("reward_lifecycle_staging_mismatch"));
  assert.throws(()=>requireRewardLifecyclePrestate(active,{...staged,activationNotBefore:now+1n},now+400000n),code("reward_lifecycle_staging_mismatch"));
});
test("an empty allocation may stage its unallocated reserve but cannot upload an empty batch",()=>{
  const p=plan("stage_allocation");p.upload=rewardAllocationCommitment({...p.upload,awards:[],budget:p.upload.budgets[0]});
  assert.equal(requireRewardLifecyclePrestate(p,accounting(p),p.upload.latestPublicationAt).completedAwards,0n);
  assert.equal(decodeFunctionData({abi:rewardCampaignAbi,data:encodeRewardLifecycle(p).data}).args[2],0n);
  assert.throws(()=>encodeRewardLifecycle({...p,action:"upload_awards",batchStart:0,batchSize:0}),code("invalid_reward_lifecycle_batch"));
});
test("canonical lifecycle signatures bind all economic arguments and preserve fixed plans during async recovery",async()=>{
  for(const action of ["upload_awards","stage_allocation","activate"]) {
    const p=plan(action);const signed=await operator.signTransaction(signing(p));const pending=verifySignedRewardLifecycle(p,signed);
    p.nonce=99n;p.upload.awards[0].amount++;p.deployment.operatorAddress=stranger.address;
    const verified=await pending;assert.equal(verified.action,action);assert.equal(verified.nonce,3n);assert.equal(verified.value,0n);assert.equal(verified.signedTransaction,signed);
  }
});
test("wrong lifecycle signer, destination, selector, nonce, value and malformed signatures are rejected",async()=>{
  const p=plan();const tx=signing(p);
  await assert.rejects(verifySignedRewardLifecycle(p,await stranger.signTransaction(tx)),code("reward_lifecycle_sender_mismatch"));
  for(const [patch,expected] of [[{chainId:143},"reward_lifecycle_transaction_chain_mismatch"],[{to:stranger.address},"reward_lifecycle_destination_mismatch"],
    [{nonce:4},"reward_lifecycle_nonce_mismatch"],[{value:1n},"reward_lifecycle_input_mismatch"],[{data:encodeRewardLifecycle(plan("activate")).data},"reward_lifecycle_input_mismatch"],
    [{data:`${tx.data}00`},"reward_lifecycle_input_mismatch"],[{accessList:[{address:stranger.address,storageKeys:[]}]},"reward_lifecycle_destination_mismatch"],
    [{gas:0n},"invalid_reward_lifecycle_fees"]])await assert.rejects(verifySignedRewardLifecycle(p,await operator.signTransaction({...tx,...patch})),code(expected));
  await assert.rejects(verifySignedRewardLifecycle(p,serializeTransaction(tx)),code("reward_unsigned_lifecycle"));
  for(const malformed of ["0x02aa",`0x02${'aa'.repeat(16385)}`,`${await operator.signTransaction(tx)}00`])await assert.rejects(verifySignedRewardLifecycle(p,malformed));
});
test("the full 64-award maximum fits bounded signature validation",async()=>{
  const p=plan();const awards=Array.from({length:64},(_,i)=>({entitlementId:toHex(BigInt(i+1),{size:32}),beneficiaryId:h(`batch beneficiary ${i}`),pot:0,
    amount:1n,explanationHash:h(`explanation ${i}`),beneficiaryKind:i%2}));
  p.upload=rewardAllocationCommitment({...p.upload,awards,budget:p.upload.budgets[0]});p.batchSize=64;
  const verified=await verifySignedRewardLifecycle(p,await operator.signTransaction(signing(p)));assert.equal(verified.batchSize,64);
});
test("lifecycle receipt readers reject unsupported context and unpinned code before RPC",async()=>{
  const reader={getChainId:()=>assert.fail("must not call")};
  await assert.rejects(readVerifiedRewardLifecycle(reader,plan(),"0x02aa","0x00"),code("reward_creation_code_mismatch"));
  const p=plan();p.deployment.context.chainId=143;
  await assert.rejects(readVerifiedRewardLifecycle(reader,p,"0x02aa","0x00"),code("unsupported_reward_chain"));
});
