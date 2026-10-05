import type { Hex } from "viem";
import { readVerifiedRewardCampaign, type RewardCampaignReader } from "./campaign-checkpoint.js";
import { requireRewardCreationBytecode } from "./deployment.js";
import { normalizeRewardLifecyclePlan, rewardLifecyclePrefix, verifySignedRewardLifecycle, type RewardLifecyclePlan } from "./lifecycle.js";
import { rewardLifecycleFromObservation } from "./lifecycle-receipts.js";
import { bytes32, demand, RewardProtocolError, uint } from "./validation.js";

/** Reverify exact signed action, pinned deployment, canonical finalized receipt
 * and the approved current upload prefix. No signing, retries, sends or DB claim. */
export async function readVerifiedRewardLifecycle(reader:RewardCampaignReader,input:RewardLifecyclePlan,signedTransaction:Hex,creationCode:Hex) {
  const p=normalizeRewardLifecyclePlan(input);const code=requireRewardCreationBytecode(creationCode);
  try {
    const attempt=await verifySignedRewardLifecycle(p,signedTransaction);
    const checkpoint=await readVerifiedRewardCampaign(reader,p.deployment,code);const finalizedBlock=checkpoint.observation.finalizedBlock;
    const [transaction,receipt]=await Promise.all([reader.getTransaction({hash:attempt.transactionHash}),reader.getTransactionReceipt({hash:attempt.transactionHash})]);
    demand(uint(receipt.blockNumber)<=finalizedBlock.number,"reward_lifecycle_not_finalized");
    demand(receipt.blockNumber>=checkpoint.deployment.deploymentBlockNumber,"reward_lifecycle_before_deployment");
    const [block,runtimeCode]=await Promise.all([reader.getBlock({blockNumber:receipt.blockNumber}),
      reader.getCode({address:p.deployment.context.verifyingContract,blockNumber:finalizedBlock.number})]);
    demand(block.number===receipt.blockNumber && block.hash!==null,"reward_lifecycle_not_canonical");
    demand(runtimeCode!==undefined,"reward_deployment_code_missing");
    const lifecycle=rewardLifecycleFromObservation(p,attempt.transactionHash,{observedChainId:checkpoint.deployment.chainId,transaction,receipt,runtimeCode,
      canonicalActionBlock:{number:block.number,hash:block.hash,timestamp:block.timestamp},finalizedBlock});
    const {accounting:a}=rewardLifecyclePrefix(p,checkpoint.observation.accounting);const u=p.upload;
    demand(a.state!==0,"reward_lifecycle_checkpoint_mismatch");
    if(p.action==="upload_awards")demand(a.entitlementCount>=BigInt(p.batchStart+p.batchSize),"reward_lifecycle_checkpoint_mismatch");
    else {
      demand(a.entitlementCount===u.entitlementCount && a.snapshotDigest===u.snapshotDigest && a.allocationDigest===u.allocationDigest,"reward_lifecycle_checkpoint_mismatch");
      if(p.action==="stage_allocation")demand([2,3,4,5].includes(a.state) && a.activationNotBefore===lifecycle.activationNotBefore,"reward_lifecycle_checkpoint_mismatch");
      else demand([3,4].includes(a.state) && lifecycle.claimDeadline!==null && a.claimDeadline>=lifecycle.claimDeadline
        && lifecycle.blockTimestamp>=a.activationNotBefore,"reward_lifecycle_checkpoint_mismatch");
    }
    // If later staging exists, its package must still be the same approved one.
    if(BigInt(a.allocationDigest)!==0n)demand(a.allocationDigest===u.allocationDigest && a.snapshotDigest===u.snapshotDigest,"reward_lifecycle_checkpoint_mismatch");
    const [chainAfter,finalityAfter,checkpointAfter,actionAfter]=await Promise.all([reader.getChainId(),reader.getBlock({blockTag:"finalized"}),
      reader.getBlock({blockNumber:finalizedBlock.number}),reader.getBlock({blockNumber:receipt.blockNumber})]);
    demand(chainAfter===attempt.chainId,"reward_observed_chain_mismatch");
    demand(finalityAfter.number!==null && finalityAfter.hash!==null && uint(finalityAfter.number)>=finalizedBlock.number,"reward_finality_regressed");
    demand(checkpointAfter.number===finalizedBlock.number && checkpointAfter.hash!==null && bytes32(checkpointAfter.hash)===finalizedBlock.hash
      && checkpointAfter.timestamp===finalizedBlock.timestamp && (finalityAfter.number!==finalizedBlock.number || bytes32(finalityAfter.hash)===finalizedBlock.hash)
      && actionAfter.number===receipt.blockNumber && actionAfter.hash!==null && bytes32(actionAfter.hash)===lifecycle.blockHash && actionAfter.timestamp===lifecycle.blockTimestamp,
      "reward_chain_changed_during_observation");
    return {lifecycle,checkpoint};
  } catch(error) {
    if(error instanceof RewardProtocolError)throw error;
    throw new RewardProtocolError("reward_lifecycle_observation_unavailable");
  }
}
