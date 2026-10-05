import { getContractAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type PublicClient } from "viem";
import { encodeRewardDeployment, rewardCampaignBuild, type RewardDeploymentSpec } from "./deployment.js";
import { bytes32, demand, rewardChainContext, RewardProtocolError, uint, walletAddress, type RewardChainContext } from "./validation.js";

export type RewardNonceReader = Pick<PublicClient, "getChainId" | "getTransactionCount">;
export type RewardDeploymentPlan = Omit<RewardDeploymentSpec, "context"> & {
  network: Pick<RewardChainContext, "environment" | "chainId">;
  nonce: bigint;
};

export function rewardDeploymentSpecFromPlan(input: RewardDeploymentPlan): RewardDeploymentSpec {
  const operatorAddress = walletAddress(input.operatorAddress); const nonce = uint(input.nonce, 64);
  demand(nonce <= BigInt(Number.MAX_SAFE_INTEGER), "reward_deployment_nonce_exhausted");
  demand(input.enabledPot === 0 || input.enabledPot === 1, "invalid_reward_pot");
  const context = rewardChainContext({ ...input.network, verifyingContract: getContractAddress({ from: operatorAddress, nonce }) });
  return { context, operatorAddress, treasuryAddress: walletAddress(input.treasuryAddress), programmeId: bytes32(input.programmeId),
    campaignId: bytes32(input.campaignId), programmeManifestHash: bytes32(input.programmeManifestHash), enabledPot: input.enabledPot };
}

/** RPC pending count is only a lower bound. SQL serializes its own reservations
 * across all campaigns using the same chain/signer. This does not lock a wallet. */
export async function readRewardPendingNonce(reader: RewardNonceReader, network: RewardDeploymentPlan["network"], operator: RewardDeploymentPlan["operatorAddress"]) {
  const context = rewardChainContext({ ...network, verifyingContract: walletAddress(operator) });
  try {
    demand(await reader.getChainId() === context.chainId, "reward_observed_chain_mismatch");
    const nonce = await reader.getTransactionCount({ address: context.verifyingContract, blockTag: "pending" });
    demand(Number.isSafeInteger(nonce) && nonce >= 0, "invalid_reward_deployment_nonce");
    demand(await reader.getChainId() === context.chainId, "reward_observed_chain_mismatch");
    return BigInt(nonce);
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_deployment_observation_unavailable");
  }
}

/** Verify operator-signed EIP-1559 bytes BEFORE durable storage/broadcast. No
 * signing key, network call or broadcast occurs here. Returned bytes are private
 * broadcast capabilities and must not enter logs/public HTTP projections. */
export async function verifySignedRewardDeployment(input: RewardDeploymentPlan, serialized: Hex) {
  const nonce = uint(input.nonce, 64); const spec = rewardDeploymentSpecFromPlan(input);
  demand(typeof serialized === "string" && /^0x02(?:[0-9a-fA-F]{2}){1,65535}$/.test(serialized), "invalid_reward_signed_deployment");
  const signedTransaction = serialized.toLowerCase() as `0x02${string}`;
  try {
    const tx = parseTransaction(signedTransaction);
    demand(tx.type === "eip1559" && tx.chainId === spec.context.chainId, "reward_deployment_transaction_chain_mismatch");
    demand(tx.to === undefined && (tx.value ?? 0n) === 0n && (tx.accessList?.length ?? 0) === 0, "reward_not_direct_deployment");
    demand(Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce!) === nonce, "reward_deployment_nonce_mismatch");
    demand(tx.r !== undefined && tx.s !== undefined && (tx.yParity === 0 || tx.yParity === 1), "reward_unsigned_deployment");
    demand(typeof tx.data === "string" && tx.data.length > 2 + 6 * 64, "reward_deployment_input_mismatch");
    // Constructor has exactly six static ABI words. Hash-check the preceding
    // creation code, then re-encode the WHOLE input using frozen programme values.
    const creationCode = tx.data.slice(0, -6 * 64) as Hex;
    demand(tx.data === encodeRewardDeployment(spec, creationCode), "reward_deployment_input_mismatch");
    demand(tx.gas !== undefined && uint(tx.gas) > 0n && tx.maxFeePerGas !== undefined && uint(tx.maxFeePerGas) > 0n
      && tx.maxPriorityFeePerGas !== undefined && uint(tx.maxPriorityFeePerGas) <= tx.maxFeePerGas, "invalid_reward_deployment_fees");
    // Reject non-canonical encodings rather than computing another transaction
    // hash from a lossy parsed form. Signature recovery uses viem, not custom ECC.
    demand(serializeTransaction(tx) === signedTransaction, "invalid_reward_signed_deployment");
    const sender = walletAddress(await recoverTransactionAddress({ serializedTransaction: signedTransaction }));
    demand(sender === spec.operatorAddress, "reward_deployment_sender_mismatch");
    return { schemaVersion: 1 as const, chainId: spec.context.chainId, operatorAddress: sender.toLowerCase() as Hex,
      nonce, contractAddress: spec.context.verifyingContract.toLowerCase() as Hex, transactionHash: keccak256(signedTransaction),
      signedTransaction, creationCodeHash: rewardCampaignBuild.creationCodeHash, calldataHash: keccak256(tx.data),
      gasLimit: tx.gas, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("invalid_reward_signed_deployment");
  }
}
