import { type Hex } from "viem";
import { readVerifiedRewardCampaign, type RewardCampaignReader } from "./campaign-checkpoint.js";
import { normalizeRewardFundingPlan, verifySignedRewardFunding, type RewardFundingPlan } from "./funding.js";
import { rewardFundingFromObservation } from "./funding-receipts.js";
import { requireRewardCreationBytecode } from "./deployment.js";
import { bytes32, demand, RewardProtocolError, uint } from "./validation.js";

/** Reverify the exact signed attempt, deployment and funding receipt, then return
 * one coherent finalized accounting checkpoint. Read-only: no key, endpoint,
 * signing, retries or sends; pending/unavailable is never funding success. */
export async function readVerifiedRewardFunding(reader: RewardCampaignReader, input: RewardFundingPlan, signedTransaction: Hex, creationCode: Hex) {
  const plan = normalizeRewardFundingPlan(input); const pinnedCode = requireRewardCreationBytecode(creationCode);
  try {
    const attempt = await verifySignedRewardFunding(plan, signedTransaction);
    const checkpoint = await readVerifiedRewardCampaign(reader, plan.deployment, pinnedCode);
    const finalizedBlock = checkpoint.observation.finalizedBlock;
    const hash = attempt.transactionHash;
    const [transaction, receipt] = await Promise.all([reader.getTransaction({ hash }), reader.getTransactionReceipt({ hash })]);
    demand(uint(receipt.blockNumber) <= finalizedBlock.number, "reward_funding_not_finalized");
    demand(receipt.blockNumber >= checkpoint.deployment.deploymentBlockNumber, "reward_funding_before_deployment");
    const [fundingBlock, runtimeCode] = await Promise.all([reader.getBlock({ blockNumber: receipt.blockNumber }),
      reader.getCode({ address: plan.deployment.context.verifyingContract, blockNumber: finalizedBlock.number })]);
    demand(fundingBlock.number === receipt.blockNumber && fundingBlock.hash !== null, "reward_funding_not_canonical");
    demand(runtimeCode !== undefined, "reward_deployment_code_missing");
    const funding = rewardFundingFromObservation(plan, hash, { observedChainId: checkpoint.deployment.chainId, transaction, receipt,
      canonicalFundingBlockHash: fundingBlock.hash, finalizedBlock, runtimeCode });
    const accounting = checkpoint.observation.accounting;
    // Later valid uploads/claims/cancellation do not erase historical funding.
    // Still reconcile immutable explicit funding and frozen budget at this block.
    demand(accounting.state !== 0 && accounting.accountedFunding === plan.expectedBudget
      && accounting.budgets[plan.deployment.enabledPot] === plan.expectedBudget, "reward_funding_checkpoint_mismatch");
    const [chainAfter, finalityAfter, checkpointAfter, fundingAfter] = await Promise.all([
      reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber: finalizedBlock.number }),
      reader.getBlock({ blockNumber: receipt.blockNumber }),
    ]);
    demand(chainAfter === attempt.chainId, "reward_observed_chain_mismatch");
    demand(finalityAfter.number !== null && finalityAfter.hash !== null && uint(finalityAfter.number) >= finalizedBlock.number, "reward_finality_regressed");
    demand(checkpointAfter.number === finalizedBlock.number && checkpointAfter.hash !== null && bytes32(checkpointAfter.hash) === finalizedBlock.hash
      && checkpointAfter.timestamp === finalizedBlock.timestamp
      && (finalityAfter.number !== finalizedBlock.number || bytes32(finalityAfter.hash) === finalizedBlock.hash)
      && fundingAfter.number === receipt.blockNumber && fundingAfter.hash !== null && bytes32(fundingAfter.hash) === funding.blockHash,
      "reward_chain_changed_during_observation");
    return { funding, checkpoint };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_funding_observation_unavailable");
  }
}
