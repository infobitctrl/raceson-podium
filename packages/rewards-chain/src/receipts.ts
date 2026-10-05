import { decodeEventLog, toEventSelector, type Hex, type TransactionReceipt } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { rewardClaimMessages, type RewardClaim } from "./claims.js";
import { bytes32, demand, rewardChainContext, uint, type RewardChainContext } from "./validation.js";

export type RewardReceiptObservation = {
  receipt: TransactionReceipt;
  observedChainId: number;
  canonicalBlockHash: Hex;
  finalizedBlockNumber: bigint;
};

const paidTopic = toEventSelector("RewardPaid(bytes32,address,uint8,uint256,uint256)");

/** Observation MUST come from the trusted worker RPC, never a browser JSON body.
 *  Check the receipt's block hash against the current canonical block and finalized
 *  head before calling. The DB projection must consume this result atomically with
 *  the persisted attempt/intent. A function argument is not independent finality proof. */
export function rewardPaymentFromReceipt(context: RewardChainContext, claim: RewardClaim, expectedTransactionHash: Hex, observed: RewardReceiptObservation) {
  const chain = rewardChainContext(context);
  const expected = rewardClaimMessages(context, claim).consent.message;
  const { receipt } = observed;
  demand(observed.observedChainId === chain.chainId, "reward_receipt_wrong_chain");
  demand(receipt.status === "success", "reward_transaction_failed");
  demand(bytes32(receipt.transactionHash) === bytes32(expectedTransactionHash), "reward_receipt_wrong_transaction");
  demand(receipt.to?.toLowerCase() === chain.verifyingContract.toLowerCase(), "reward_receipt_wrong_contract");
  uint(receipt.blockNumber); uint(observed.finalizedBlockNumber);
  demand(bytes32(receipt.blockHash) === bytes32(observed.canonicalBlockHash), "reward_receipt_noncanonical");
  demand(receipt.blockNumber <= observed.finalizedBlockNumber, "reward_receipt_not_finalized");
  const matches = receipt.logs.filter((log) => log.address.toLowerCase() === chain.verifyingContract.toLowerCase()
    && log.topics[0]?.toLowerCase() === paidTopic).map((log) => {
    try {
      const decoded = decodeEventLog({ abi: rewardCampaignAbi, eventName: "RewardPaid", data: log.data, topics: log.topics, strict: true });
      return { log, args: decoded.args };
    } catch { demand(false, "invalid_reward_payment_event"); }
  });
  demand(matches.length === 1, "reward_payment_event_count_mismatch");
  const { log, args } = matches[0];
  demand(log.removed === false && log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0, "invalid_reward_payment_log");
  demand(log.transactionHash === receipt.transactionHash && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber, "reward_log_receipt_mismatch");
  demand(args.entitlementId === expected.entitlementId && args.recipient.toLowerCase() === expected.recipient.toLowerCase()
    && args.amount === expected.amount && args.pot === expected.pot && args.nonce === expected.nonce, "reward_payment_intent_mismatch");
  return { chainId: chain.chainId, contract: chain.verifyingContract, transactionHash: bytes32(receipt.transactionHash),
    blockHash: bytes32(receipt.blockHash), blockNumber: receipt.blockNumber, logIndex: log.logIndex,
    entitlementId: expected.entitlementId, recipient: expected.recipient, amount: expected.amount, pot: claim.pot, nonce: expected.nonce };
}
