import { keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Address, type Hex } from "viem";
import { demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

// Internal shared envelope validation only. Public athlete/club entry points
// retain their distinct award and consent policies; this is not a payout API.
export type RewardPaymentCall = { chainId: number; to: Address; nonce: number; value: bigint; data: Hex };
export function rewardSignedPaymentBytes(value: Hex, maxBytes: 2048 | 12288) {
  demand(typeof value === "string" && value.length >= 6 && value.length <= 4 + maxBytes * 2
    && /^0x02(?:[0-9a-fA-F]{2})+$/.test(value), "invalid_reward_signed_payment");
  return value.toLowerCase() as `0x02${string}`;
}
export async function verifyRewardSignedPaymentEnvelope(encoded: RewardPaymentCall, relayer: Address, serialized: Hex, maxBytes: 2048 | 12288) {
  const signedTransaction = rewardSignedPaymentBytes(serialized, maxBytes);
  try {
    const tx = parseTransaction(signedTransaction);
    demand(tx.type === "eip1559" && tx.chainId === encoded.chainId, "reward_payment_transaction_chain_mismatch");
    demand(tx.to != null && walletAddress(tx.to) === encoded.to && (tx.accessList?.length ?? 0) === 0, "reward_payment_destination_mismatch");
    demand(Number.isSafeInteger(tx.nonce) && tx.nonce === encoded.nonce, "reward_payment_nonce_mismatch");
    demand(encoded.value === 0n && (tx.value ?? 0n) === 0n && tx.data === encoded.data, "reward_payment_input_mismatch");
    demand(tx.r !== undefined && tx.s !== undefined && (tx.yParity === 0 || tx.yParity === 1), "reward_unsigned_payment");
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    demand(BigInt(tx.r) > 0n && BigInt(tx.r) < order && BigInt(tx.s) > 0n && BigInt(tx.s) <= order / 2n, "invalid_reward_signed_payment");
    // Canonical zero priority fee is an empty RLP scalar. viem may decode it as
    // undefined; that is zero, not a missing or unsigned fee authorization.
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? 0n;
    demand(tx.gas !== undefined && uint(tx.gas, 64) > 0n && tx.maxFeePerGas !== undefined && uint(tx.maxFeePerGas) > 0n
      && uint(maxPriorityFeePerGas) <= tx.maxFeePerGas, "invalid_reward_payment_fees");
    uint(tx.gas * tx.maxFeePerGas);
    demand(serializeTransaction(tx) === signedTransaction, "invalid_reward_signed_payment");
    const sender = walletAddress(await recoverTransactionAddress({ serializedTransaction: signedTransaction }));
    demand(sender === relayer, "reward_payment_sender_mismatch");
    return { signedTransaction, transactionHash: keccak256(signedTransaction), relayerAddress: sender.toLowerCase() as Address,
      calldataHash: keccak256(encoded.data), value: 0n, gasLimit: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas };
  } catch (error) { if (error instanceof RewardProtocolError) throw error; throw new RewardProtocolError("invalid_reward_signed_payment"); }
}
