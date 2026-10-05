import { encodeAbiParameters, encodeEventTopics, type Hex, type Transaction, type TransactionReceipt } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { verifyRewardRuntime } from "./deployment.js";
import { encodeRewardFunding, normalizeRewardFundingPlan, type RewardFundingPlan } from "./funding.js";
import { bytes32, demand, uint, walletAddress } from "./validation.js";

export type RewardFundingObservation = {
  observedChainId: number;
  transaction: Transaction;
  receipt: TransactionReceipt;
  canonicalFundingBlockHash: Hex;
  finalizedBlock: { number: bigint; hash: Hex; timestamp: bigint };
  runtimeCode: Hex;
};

/** Trusted worker observations only. The hash must come from a verified stored
 * signed attempt. Exact receipt evidence is required; a matching current balance
 * or another operator transaction's FundingClosed event is not this payment. */
export function rewardFundingFromObservation(input: RewardFundingPlan, transactionHash: Hex, observed: RewardFundingObservation) {
  const plan = normalizeRewardFundingPlan(input); const encoded = encodeRewardFunding(plan); const hash = bytes32(transactionHash);
  const { receipt, transaction: tx } = observed;
  demand(observed.observedChainId === encoded.chainId && tx.chainId === encoded.chainId, "reward_funding_transaction_chain_mismatch");
  demand(receipt.status === "success", "reward_funding_reverted");
  demand(bytes32(receipt.transactionHash) === hash && bytes32(tx.hash) === hash, "reward_funding_transaction_mismatch");
  demand(receipt.to !== null && tx.to !== null && walletAddress(receipt.to) === encoded.to && walletAddress(tx.to) === encoded.to
    && receipt.contractAddress === null, "reward_funding_destination_mismatch");
  demand(walletAddress(receipt.from) === plan.deployment.operatorAddress && walletAddress(tx.from) === plan.deployment.operatorAddress,
    "reward_funding_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce) && tx.nonce === encoded.nonce, "reward_funding_nonce_mismatch");
  demand(tx.type === "eip1559" && tx.value === encoded.value && tx.input === encoded.data && (tx.accessList?.length ?? 0) === 0,
    "reward_funding_input_mismatch");
  const blockNumber = uint(receipt.blockNumber); const blockHash = bytes32(receipt.blockHash);
  const finalizedBlock = { number: uint(observed.finalizedBlock.number), hash: bytes32(observed.finalizedBlock.hash), timestamp: uint(observed.finalizedBlock.timestamp) };
  demand(tx.blockNumber === blockNumber && tx.blockHash !== null && bytes32(tx.blockHash) === blockHash
    && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex,
    "reward_funding_receipt_mismatch");
  demand(blockNumber <= finalizedBlock.number, "reward_funding_not_finalized");
  demand(blockHash === bytes32(observed.canonicalFundingBlockHash) && (blockNumber !== finalizedBlock.number || blockHash === finalizedBlock.hash),
    "reward_funding_not_canonical");
  const runtimeCodeHash = verifyRewardRuntime(plan.deployment, observed.runtimeCode);

  // completeFunding performs no external call and emits exactly these events in
  // order. Compare the complete ABI encoding (including lengths), not a permissive
  // decoder which might discard trailing bytes or extra topics.
  const expectedLogs = [
    ...(encoded.value === 0n ? [] : [{ topics: encodeEventTopics({ abi: rewardCampaignAbi, eventName: "Funded", args: { funder: plan.deployment.operatorAddress } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [encoded.value, plan.expectedBudget]) }]),
    { topics: encodeEventTopics({ abi: rewardCampaignAbi, eventName: "FundingClosed", args: { pot: plan.deployment.enabledPot } }),
      data: encodeAbiParameters([{ type: "uint256" }], [plan.expectedBudget]) },
  ];
  demand(Array.isArray(receipt.logs) && receipt.logs.length === expectedLogs.length, "reward_funding_event_count_mismatch");
  let previousIndex = -1;
  for (let i = 0; i < expectedLogs.length; i++) {
    const log = receipt.logs[i]; const expected = expectedLogs[i];
    demand(log.removed === false && Number.isSafeInteger(log.logIndex) && log.logIndex !== null && log.logIndex > previousIndex,
      "invalid_reward_funding_log");
    demand(log.blockNumber === blockNumber && log.blockHash === blockHash && log.transactionHash === hash
      && log.transactionIndex === receipt.transactionIndex, "reward_funding_log_receipt_mismatch");
    demand(walletAddress(log.address) === encoded.to && log.data.toLowerCase() === expected.data
      && log.topics.length === expected.topics.length && log.topics.every((topic, index) => topic.toLowerCase() === expected.topics[index]),
      "reward_funding_event_mismatch");
    previousIndex = log.logIndex;
  }
  return { schemaVersion: 1 as const, action: "complete_funding" as const, chainId: encoded.chainId,
    contractAddress: encoded.to.toLowerCase() as Hex, operatorAddress: plan.deployment.operatorAddress.toLowerCase() as Hex,
    transactionHash: hash, nonce: plan.nonce, blockNumber, blockHash, fundingClosedLogIndex: previousIndex,
    depositedValue: encoded.value, expectedAccountedFunding: plan.expectedAccountedFunding, budget: plan.expectedBudget,
    enabledPot: plan.deployment.enabledPot, runtimeCodeHash, finalizedBlock };
}
