import { keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { encodeRewardProgrammeDeploymentV3, normalizeRewardProgrammePlanV3, rewardProgrammeV3Build, type RewardProgrammePlanV3 } from "./programme-v3.js";
import { demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

/** Local cryptographic validation only. These returned signed bytes are private
 * broadcast capabilities: never include them in browser projections or logs.
 * A valid signature does not authorize a job, approve sources or move funds. */
export async function verifySignedProgrammeDeploymentV3(input: RewardProgrammePlanV3, serialized: Hex,
  maximumGasCostWei: bigint) {
  const plan = normalizeRewardProgrammePlanV3(input), ceiling = uint(maximumGasCostWei);
  demand(ceiling > 0n && typeof serialized === "string" && /^0x02(?:[0-9a-fA-F]{2}){1,65535}$/.test(serialized), "invalid_programme_signed_deployment");
  const signedTransaction = serialized.toLowerCase() as `0x02${string}`;
  try {
    const tx = parseTransaction(signedTransaction);
    demand(tx.type === "eip1559" && tx.chainId === plan.context.chainId, "reward_deployment_transaction_chain_mismatch");
    demand(tx.to === undefined && (tx.value ?? 0n) === 0n && (tx.accessList?.length ?? 0) === 0, "reward_not_direct_deployment");
    demand(Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce!) === plan.deploymentNonce, "reward_deployment_nonce_mismatch");
    demand(tx.r !== undefined && tx.s !== undefined && (tx.yParity === 0 || tx.yParity === 1), "reward_unsigned_deployment");
    demand(typeof tx.data === "string" && tx.data.length > 2 + 2 * rewardProgrammeV3Build.creationBytes, "reward_deployment_input_mismatch");
    const code = tx.data.slice(0, 2 + 2 * rewardProgrammeV3Build.creationBytes) as Hex;
    demand(tx.data === encodeRewardProgrammeDeploymentV3(plan, code), "reward_deployment_input_mismatch");
    // viem decodes canonical zero-priority RLP as undefined. It is a valid zero
    // tip, not missing fee consent; reserialization below still checks all bytes.
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? 0n;
    demand(tx.gas !== undefined && uint(tx.gas) > 0n && tx.gas <= 30_000_000n
      && tx.maxFeePerGas !== undefined && uint(tx.maxFeePerGas) > 0n
      && uint(maxPriorityFeePerGas) <= tx.maxFeePerGas
      && tx.gas * tx.maxFeePerGas <= ceiling, "invalid_reward_deployment_fees");
    demand(serializeTransaction(tx) === signedTransaction, "invalid_programme_signed_deployment");
    const sender = walletAddress(await recoverTransactionAddress({ serializedTransaction: signedTransaction }));
    demand(sender === plan.operatorAddress, "reward_deployment_sender_mismatch");
    return { schemaVersion: 3 as const, chainId: plan.context.chainId, operatorAddress: sender,
      nonce: plan.deploymentNonce, contractAddress: plan.context.verifyingContract, transactionHash: keccak256(signedTransaction),
      signedTransaction, creationCodeHash: rewardProgrammeV3Build.creationCodeHash, calldataHash: keccak256(tx.data),
      gasLimit: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas, maximumGasCostWei: ceiling };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("invalid_programme_signed_deployment");
  }
}
