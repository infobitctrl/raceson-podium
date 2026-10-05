import { type Hex, type PublicClient } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { normalizeRewardDeployment, type RewardDeploymentExpectation } from "./deployment.js";
import { readVerifiedRewardDeployment, type RewardDeploymentReader } from "./deployment-reader.js";
import { bytes32, demand, RewardProtocolError, uint } from "./validation.js";

export type RewardCampaignAccounting = {
  state: number; paused: boolean; accountedFunding: bigint; treasuryReturned: bigint;
  budgets: readonly [bigint, bigint]; allocated: readonly [bigint, bigint]; paid: readonly [bigint, bigint];
  nativeBalance: bigint; entitlementCount: bigint; uploadDigest: Hex; snapshotDigest: Hex; allocationDigest: Hex;
  activationNotBefore: bigint; claimDeadline: bigint; pausedAt: bigint;
};

/** Accounting truth, not the programme's expected funding or permission to act.
 * Under/overfunding remains observable; it must not be hidden as an RPC failure. */
export function validateRewardCampaignAccounting(input: RewardCampaignAccounting, enabledPot: 0 | 1) {
  demand(enabledPot === 0 || enabledPot === 1, "invalid_reward_pot");
  const pair = (value: readonly [bigint, bigint]): [bigint, bigint] => {
    demand(Array.isArray(value) && value.length === 2, "invalid_reward_accounting"); return [uint(value[0]), uint(value[1])];
  };
  demand(Number.isInteger(input.state) && input.state >= 0 && input.state <= 5 && typeof input.paused === "boolean", "invalid_reward_accounting");
  const a = { state: input.state, paused: input.paused, accountedFunding: uint(input.accountedFunding), treasuryReturned: uint(input.treasuryReturned),
    budgets: pair(input.budgets), allocated: pair(input.allocated), paid: pair(input.paid), nativeBalance: uint(input.nativeBalance),
    entitlementCount: uint(input.entitlementCount), uploadDigest: bytes32(input.uploadDigest, true), snapshotDigest: bytes32(input.snapshotDigest, true),
    allocationDigest: bytes32(input.allocationDigest, true), activationNotBefore: uint(input.activationNotBefore), claimDeadline: uint(input.claimDeadline), pausedAt: uint(input.pausedAt) };
  const other = 1 - enabledPot; const budget = a.budgets[enabledPot]; const allocated = a.allocated[enabledPot]; const paid = a.paid[enabledPot];
  demand(a.budgets[other] === 0n && a.allocated[other] === 0n && a.paid[other] === 0n
    && paid <= allocated && allocated <= budget && budget <= a.accountedFunding
    && paid + a.treasuryReturned <= a.accountedFunding, "reward_accounting_conservation_mismatch");
  demand(a.nativeBalance >= a.accountedFunding - paid - a.treasuryReturned, "reward_accounting_balance_shortfall");
  const zero = (value: Hex) => BigInt(value) === 0n;
  const unstaged = zero(a.snapshotDigest) && zero(a.allocationDigest) && a.activationNotBefore === 0n;
  const staged = !zero(a.snapshotDigest) && !zero(a.allocationDigest) && a.activationNotBefore > 0n;
  demand((a.entitlementCount === 0n) === (allocated === 0n) && (a.entitlementCount === 0n) === zero(a.uploadDigest), "reward_accounting_upload_mismatch");
  demand((a.state === 0 || a.state === 5 || (budget > 0n && budget === a.accountedFunding))
    && (budget === 0n || budget === a.accountedFunding), "reward_accounting_funding_mismatch");
  demand((a.state !== 0 || (budget === 0n && a.entitlementCount === 0n && unstaged))
    && (a.state !== 1 || unstaged) && (![2,3,4].includes(a.state) || staged)
    && (a.state !== 5 || unstaged || staged), "reward_accounting_lifecycle_mismatch");
  demand(([3,4].includes(a.state) ? a.claimDeadline > 0n : a.claimDeadline === 0n)
    && ([3,4].includes(a.state) || paid === 0n)
    && ([4,5].includes(a.state) || a.treasuryReturned === 0n)
    && (!a.paused || (a.state === 3 && a.pausedAt > 0n))
    && (a.paused || a.pausedAt === 0n), "reward_accounting_lifecycle_mismatch");
  return a;
}

/** Descriptive only. A matching budget does not mean active/claimable, and raw
 * native balance never substitutes for explicit accounted deposits. */
export function rewardCampaignFundingSummary(input: RewardCampaignAccounting, enabledPot: 0 | 1, expectedBudget: bigint) {
  const a = validateRewardCampaignAccounting(input, enabledPot); const expected = uint(expectedBudget);
  demand(expected > 0n, "invalid_reward_expected_budget");
  const remainingAccounted = a.accountedFunding - a.paid[enabledPot] - a.treasuryReturned;
  return { expectedBudget: expected, deposited: a.accountedFunding,
    shortfall: a.accountedFunding < expected ? expected - a.accountedFunding : 0n,
    excess: a.accountedFunding > expected ? a.accountedFunding - expected : 0n,
    remainingAccounted, forcedSurplus: a.nativeBalance - remainingAccounted,
    unpaidAllocated: a.allocated[enabledPot] - a.paid[enabledPot],
    fundingClosed: a.budgets[enabledPot] > 0n,
    fixedBudgetMatches: a.budgets[enabledPot] === expected && a.accountedFunding === expected,
    state: a.state, paused: a.paused };
}

export type RewardCampaignReader = RewardDeploymentReader & Pick<PublicClient, "readContract" | "getBalance">;

/** One finalized identity/accounting checkpoint, from a configured worker client.
 * No broadcast, signing, RPC fallback, current-state lease or user endpoint. */
export async function readVerifiedRewardCampaign(reader: RewardCampaignReader, input: RewardDeploymentExpectation, creationCode: Hex) {
  const expected = normalizeRewardDeployment(input);
  try {
    const verified = await readVerifiedRewardDeployment(reader, expected, creationCode);
    const finalizedBlock = verified.finalizedBlock;
    const address = expected.context.verifyingContract; const blockNumber = finalizedBlock.number;
    const scalarNames = ["state", "paused", "accountedFunding", "treasuryReturned", "entitlementCount", "uploadDigest", "snapshotDigest",
      "allocationDigest", "activationNotBefore", "claimDeadline", "pausedAt"] as const;
    const scalars = await Promise.all(scalarNames.map(functionName => reader.readContract({ address, abi: rewardCampaignAbi, functionName, blockNumber })));
    const readPair = async (functionName: "budgets" | "allocated" | "paid") => Promise.all([0n,1n].map(index => reader.readContract({
      address, abi: rewardCampaignAbi, functionName, args: [index], blockNumber }))) as Promise<[bigint, bigint]>;
    const [budgets, allocated, paid, nativeBalance] = await Promise.all([readPair("budgets"), readPair("allocated"), readPair("paid"), reader.getBalance({ address, blockNumber })]);
    // The mapping names come from the fixed ABI list above; the validator still
    // checks every returned runtime value, rather than trusting this TS mapping.
    const scalar = Object.fromEntries(scalarNames.map((name, index) => [name, scalars[index]])) as Pick<RewardCampaignAccounting, typeof scalarNames[number]>;
    const accounting = validateRewardCampaignAccounting({ ...scalar, budgets, allocated, paid, nativeBalance }, expected.enabledPot);
    demand(!accounting.paused || accounting.pausedAt <= finalizedBlock.timestamp, "reward_accounting_lifecycle_mismatch");
    const [chainAfter, finalityAfter, canonicalAfter] = await Promise.all([reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber })]);
    demand(chainAfter === expected.context.chainId, "reward_observed_chain_mismatch");
    demand(finalityAfter.number !== null && finalityAfter.hash !== null && finalityAfter.number >= blockNumber, "reward_finality_regressed");
    demand(canonicalAfter.number === blockNumber && canonicalAfter.hash !== null && bytes32(canonicalAfter.hash) === finalizedBlock.hash
      && canonicalAfter.timestamp === finalizedBlock.timestamp && (finalityAfter.number !== blockNumber || bytes32(finalityAfter.hash) === finalizedBlock.hash),
    "reward_chain_changed_during_observation");
    return { deployment: { schemaVersion: 1 as const, chainId: expected.context.chainId, contractAddress: address.toLowerCase() as Hex,
      buildId: verified.buildId, creationCodeHash: verified.creationCodeHash, runtimeCodeHash: verified.runtimeCodeHash,
      deploymentTransactionHash: expected.deploymentTransactionHash, deploymentNonce: expected.deploymentNonce,
      deploymentBlockNumber: verified.deploymentBlockNumber, deploymentBlockHash: verified.deploymentBlockHash },
    observation: { schemaVersion: 1 as const, finalizedBlock, accounting } };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_campaign_observation_unavailable");
  }
}
