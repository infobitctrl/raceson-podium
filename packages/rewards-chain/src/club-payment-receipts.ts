import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { requireLiveRewardClaim } from "./claims.js";
import { verifyRewardRuntime } from "./deployment.js";
import { encodeRewardClubPayment, normalizeRewardClubPaymentPlan, type RewardClubPaymentPlan } from "./club-payments.js";
import type { RewardAthletePaymentObservation } from "./payment-receipts.js";
import { bytes32, demand, uint, walletAddress } from "./validation.js";

// The observation transport shape is shared, not athlete recipient policy.
export type RewardClubPaymentObservation = RewardAthletePaymentObservation;
const safeReceivedAbi = parseAbi(["event SafeReceived(address indexed sender,uint256 value)"]);

/** A hash from a verified stored signed attempt is required. Exact receipt
 * evidence only, not signature recovery, current treasury control or a DB write.
 * The campaign emits RewardPaid before _transfer; the original Safe then emits
 * SafeReceived. A receiver revert rolls back both events and the paid state. */
export function rewardClubPaymentFromObservation(input: RewardClubPaymentPlan, transactionHash: Hex, observed: RewardClubPaymentObservation) {
  const p = normalizeRewardClubPaymentPlan(input), encoded = encodeRewardClubPayment(p), hash = bytes32(transactionHash);
  const { receipt: r, transaction: tx } = observed;
  const block = { number: uint(observed.canonicalPaymentBlock.number), hash: bytes32(observed.canonicalPaymentBlock.hash), timestamp: uint(observed.canonicalPaymentBlock.timestamp) };
  const finalizedBlock = { number: uint(observed.finalizedBlock.number), hash: bytes32(observed.finalizedBlock.hash), timestamp: uint(observed.finalizedBlock.timestamp) };
  demand(observed.observedChainId === encoded.chainId && tx.chainId === encoded.chainId, "reward_payment_transaction_chain_mismatch");
  demand(r.status === "success", "reward_payment_reverted");
  demand(bytes32(r.transactionHash) === hash && bytes32(tx.hash) === hash, "reward_payment_transaction_mismatch");
  demand(r.to !== null && tx.to !== null && walletAddress(r.to) === encoded.to && walletAddress(tx.to) === encoded.to && r.contractAddress === null, "reward_payment_destination_mismatch");
  demand(walletAddress(r.from) === p.relayerAddress && walletAddress(tx.from) === p.relayerAddress, "reward_payment_sender_mismatch");
  demand(Number.isSafeInteger(tx.nonce) && tx.nonce === encoded.nonce, "reward_payment_nonce_mismatch");
  demand(tx.type === "eip1559" && tx.value === 0n && tx.input === encoded.data && (tx.accessList?.length ?? 0) === 0, "reward_payment_input_mismatch");
  demand(r.blockNumber === block.number && bytes32(r.blockHash) === block.hash && tx.blockNumber === block.number && tx.blockHash !== null && bytes32(tx.blockHash) === block.hash
    && Number.isSafeInteger(r.transactionIndex) && r.transactionIndex >= 0 && tx.transactionIndex === r.transactionIndex, "reward_payment_receipt_mismatch");
  demand(block.number <= finalizedBlock.number && block.timestamp <= finalizedBlock.timestamp, "reward_payment_not_finalized");
  demand(block.number !== finalizedBlock.number || (block.hash === finalizedBlock.hash && block.timestamp === finalizedBlock.timestamp), "reward_payment_not_canonical");
  const consent = p.consentCheckpoint;
  demand(block.number >= consent.number && block.timestamp >= consent.timestamp
    && (block.number !== consent.number || (block.hash === consent.hash && block.timestamp === consent.timestamp)), "reward_club_payment_before_consent");
  requireLiveRewardClaim(p.expected.deployment.context, p.claim, block.timestamp, p.claim.expiresAt);
  const runtimeCodeHash = verifyRewardRuntime(p.expected.deployment, observed.runtimeCode);
  demand(Array.isArray(r.logs) && r.logs.length === 2, "reward_payment_event_count_mismatch");
  const expected = [
    { address: encoded.to, topics: encodeEventTopics({ abi: rewardCampaignAbi, eventName: "RewardPaid", args: {
      entitlementId: p.claim.entitlementId, recipient: p.claim.recipient, pot: p.claim.pot === "race" ? 0 : 1 } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [p.claim.amount, p.claim.nonce]) },
    { address: p.claim.recipient, topics: encodeEventTopics({ abi: safeReceivedAbi, eventName: "SafeReceived", args: { sender: encoded.to } }),
      data: encodeAbiParameters([{ type: "uint256" }], [p.claim.amount]) },
  ];
  for (const [index, log] of r.logs.entries()) {
    const e = expected[index];
    demand(log.removed === false && log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0, "invalid_reward_payment_log");
    demand(log.blockNumber === block.number && log.blockHash === block.hash && log.transactionHash === hash
      && log.transactionIndex === r.transactionIndex, "reward_payment_log_receipt_mismatch");
    demand(walletAddress(log.address) === e.address && log.data.toLowerCase() === e.data && log.topics.length === e.topics.length
      && log.topics.every((topic, i) => topic.toLowerCase() === e.topics[i]), "reward_payment_event_mismatch");
  }
  demand(r.logs[1].logIndex === r.logs[0].logIndex! + 1, "reward_payment_event_order_mismatch");
  demand(tx.gas > 0n && uint(r.gasUsed) <= tx.gas && tx.maxFeePerGas !== undefined && uint(r.effectiveGasPrice) <= tx.maxFeePerGas, "reward_payment_gas_mismatch");
  return { schemaVersion: 1 as const, action: "pay_club" as const, chainId: encoded.chainId, contractAddress: encoded.to.toLowerCase() as Hex,
    relayerAddress: p.relayerAddress.toLowerCase() as Hex, transactionHash: hash, nonce: p.nonce, blockNumber: block.number, blockHash: block.hash,
    blockTimestamp: block.timestamp, logIndex: r.logs[0].logIndex!, safeReceivedLogIndex: r.logs[1].logIndex!,
    entitlementId: p.claim.entitlementId, recipient: p.claim.recipient.toLowerCase() as Hex, amount: p.claim.amount, pot: p.claim.pot,
    authorizationNonce: p.claim.nonce, allocationDigest: p.claim.allocationDigest,
    gasLimit: tx.gas, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice,
    // Signed gas-limit charge estimate, not a measured account debit.
    monadGasLimitFee: uint(tx.gas * r.effectiveGasPrice), runtimeCodeHash, finalizedBlock };
}
