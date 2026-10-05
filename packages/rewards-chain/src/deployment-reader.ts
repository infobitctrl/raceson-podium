import { type Hex, type PublicClient } from "viem";
import { normalizeRewardDeployment, requireRewardCreationBytecode, rewardCreationCodeFromTransaction, verifyRewardDeployment, type RewardDeploymentExpectation } from "./deployment.js";
import { bytes32, demand, RewardProtocolError, uint } from "./validation.js";

/** Worker-owned client only. No endpoint from an HTTP request and no signer,
 * wallet method, fallback to latest/safe, retries or implicit network creation. */
export type RewardDeploymentReader = Pick<PublicClient, "getChainId" | "getBlock" | "getTransaction" | "getTransactionReceipt" | "getCode">;

/** Resolves a runtime dependency without reading a local ignored compiler file.
 * Fixed hash pin still applies; full finalized instance verification must follow. */
export async function readRewardCreationBytecode(reader: RewardDeploymentReader, input: RewardDeploymentExpectation) {
  const expected = normalizeRewardDeployment(input);
  try {
    demand(await reader.getChainId() === expected.context.chainId, "reward_observed_chain_mismatch");
    return rewardCreationCodeFromTransaction(expected, await reader.getTransaction({ hash: expected.deploymentTransactionHash }));
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_deployment_observation_unavailable");
  }
}

export async function readVerifiedRewardDeployment(reader: RewardDeploymentReader, input: RewardDeploymentExpectation, creationCode: Hex) {
  try { return await collectDeployment(reader, input, creationCode); }
  catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    // RPC errors may embed authenticated endpoint URLs. Do not leak the original
    // error/cause through a future worker log or HTTP boundary. Unavailable is not
    // evidence that a transaction was absent/reverted or safe to replace.
    throw new RewardProtocolError("reward_deployment_observation_unavailable");
  }
}

async function collectDeployment(reader: RewardDeploymentReader, input: RewardDeploymentExpectation, creationCode: Hex) {
  // Copy caller-owned values before the first await. No later read of input.
  const expected = normalizeRewardDeployment(input);
  const pinnedCode = requireRewardCreationBytecode(creationCode);
  const observedChainId = await reader.getChainId();
  demand(observedChainId === expected.context.chainId, "reward_observed_chain_mismatch");
  const finalized = await reader.getBlock({ blockTag: "finalized" });
  demand(finalized.number !== null && finalized.hash !== null, "reward_finalized_block_missing");
  const finalizedBlock = { number: uint(finalized.number), hash: bytes32(finalized.hash), timestamp: uint(finalized.timestamp) };
  const hash = expected.deploymentTransactionHash;
  const [transaction, receipt] = await Promise.all([reader.getTransaction({ hash }), reader.getTransactionReceipt({ hash })]);
  demand(uint(receipt.blockNumber) <= finalizedBlock.number, "reward_deployment_not_finalized");
  const [deploymentBlock, runtimeCode] = await Promise.all([
    reader.getBlock({ blockNumber: receipt.blockNumber }),
    reader.getCode({ address: expected.context.verifyingContract, blockNumber: finalizedBlock.number }),
  ]);
  demand(deploymentBlock.number === receipt.blockNumber && deploymentBlock.hash !== null, "reward_deployment_not_canonical");
  demand(runtimeCode !== undefined, "reward_deployment_code_missing");
  const result = verifyRewardDeployment(expected, pinnedCode, { transaction, receipt, observedChainId, finalizedBlock,
    canonicalDeploymentBlockHash: deploymentBlock.hash, runtimeCode });
  // Recheck both canonical block identities and the network after all reads. This
  // detects drift/reorg/misrouting, not a dishonest RPC or consensus finality failure.
  const [chainIdAfter, finalizedAgain, checkpointAgain, deploymentAgain] = await Promise.all([
    reader.getChainId(), reader.getBlock({ blockTag: "finalized" }),
    reader.getBlock({ blockNumber: finalizedBlock.number }), reader.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  demand(chainIdAfter === observedChainId, "reward_observed_chain_mismatch");
  demand(finalizedAgain.number !== null && finalizedAgain.hash !== null && uint(finalizedAgain.number) >= finalizedBlock.number,
    "reward_finality_regressed");
  demand(checkpointAgain.number === finalizedBlock.number && checkpointAgain.hash !== null && bytes32(checkpointAgain.hash) === finalizedBlock.hash
    && checkpointAgain.timestamp === finalizedBlock.timestamp
    && (finalizedAgain.number !== finalizedBlock.number || bytes32(finalizedAgain.hash) === finalizedBlock.hash)
    && deploymentAgain.number === receipt.blockNumber && deploymentAgain.hash !== null && bytes32(deploymentAgain.hash) === result.deploymentBlockHash,
  "reward_chain_changed_during_observation");
  return result;
}
