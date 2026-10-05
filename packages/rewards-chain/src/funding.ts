import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { normalizeRewardDeployment, rewardCampaignBuild, type RewardDeploymentExpectation } from "./deployment.js";
import { demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

/** Expected values must come from the private programme and verified deployment.
 * A plan is not a nonce reservation, fresh accounting observation or permission
 * to sign/send. In particular, never accept expectedBudget from browser JSON. */
export type RewardFundingPlan = {
  deployment: RewardDeploymentExpectation;
  nonce: bigint;
  expectedAccountedFunding: bigint;
  expectedBudget: bigint;
};

export function normalizeRewardFundingPlan(input: RewardFundingPlan): RewardFundingPlan {
  const deployment = normalizeRewardDeployment(input.deployment);
  const nonce = uint(input.nonce, 64);
  demand(nonce <= BigInt(Number.MAX_SAFE_INTEGER) && nonce > deployment.deploymentNonce, "invalid_reward_funding_nonce");
  const expectedBudget = uint(input.expectedBudget); const expectedAccountedFunding = uint(input.expectedAccountedFunding);
  demand(expectedBudget > 0n && expectedAccountedFunding <= expectedBudget, "invalid_reward_funding_budget");
  return { deployment, nonce, expectedAccountedFunding, expectedBudget };
}

/** One allowed economic operation. No arbitrary calldata, keys, gas selection,
 * network calls or broadcast. Forced native surplus never reduces this value. */
export function encodeRewardFunding(input: RewardFundingPlan) {
  const plan = normalizeRewardFundingPlan(input);
  return { chainId: plan.deployment.context.chainId, to: plan.deployment.context.verifyingContract,
    nonce: Number(plan.nonce), value: plan.expectedBudget - plan.expectedAccountedFunding,
    data: encodeFunctionData({ abi: rewardCampaignAbi, functionName: "completeFunding",
      args: [plan.expectedAccountedFunding, plan.expectedBudget] }) };
}

/** Private signed bytes are broadcast capabilities. Recovery uses pinned viem;
 * this module never generates a wallet, stores keys or transmits the bytes. */
export async function verifySignedRewardFunding(input: RewardFundingPlan, serialized: Hex) {
  const plan = normalizeRewardFundingPlan(input); const encoded = encodeRewardFunding(plan);
  demand(typeof serialized === "string" && /^0x02(?:[0-9a-fA-F]{2}){1,1024}$/.test(serialized), "invalid_reward_signed_funding");
  const signedTransaction = serialized.toLowerCase() as `0x02${string}`;
  try {
    const tx = parseTransaction(signedTransaction);
    demand(tx.type === "eip1559" && tx.chainId === encoded.chainId, "reward_funding_transaction_chain_mismatch");
    demand(tx.to !== undefined && tx.to !== null && walletAddress(tx.to) === encoded.to && (tx.accessList?.length ?? 0) === 0, "reward_funding_destination_mismatch");
    demand(Number.isSafeInteger(tx.nonce) && tx.nonce === encoded.nonce, "reward_funding_nonce_mismatch");
    demand((tx.value ?? 0n) === encoded.value && tx.data === encoded.data, "reward_funding_input_mismatch");
    demand(tx.r !== undefined && tx.s !== undefined && (tx.yParity === 0 || tx.yParity === 1), "reward_unsigned_funding");
    demand(tx.gas !== undefined && uint(tx.gas) > 0n && tx.maxFeePerGas !== undefined && uint(tx.maxFeePerGas) > 0n
      && tx.maxPriorityFeePerGas !== undefined && uint(tx.maxPriorityFeePerGas) <= tx.maxFeePerGas, "invalid_reward_funding_fees");
    demand(serializeTransaction(tx) === signedTransaction, "invalid_reward_signed_funding");
    const sender = walletAddress(await recoverTransactionAddress({ serializedTransaction: signedTransaction }));
    demand(sender === plan.deployment.operatorAddress, "reward_funding_sender_mismatch");
    return { schemaVersion: 1 as const, action: "complete_funding" as const, chainId: encoded.chainId,
      operatorAddress: sender.toLowerCase() as Hex, nonce: plan.nonce, contractAddress: encoded.to.toLowerCase() as Hex,
      transactionHash: keccak256(signedTransaction), signedTransaction, buildId: rewardCampaignBuild.id,
      calldataHash: keccak256(encoded.data), expectedAccountedFunding: plan.expectedAccountedFunding,
      expectedBudget: plan.expectedBudget, value: encoded.value, gasLimit: tx.gas,
      maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("invalid_reward_signed_funding");
  }
}
