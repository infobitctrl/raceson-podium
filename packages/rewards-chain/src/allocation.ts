import { aggregateRewardEntitlements, type RewardAllocationResult } from "@raceson/domain/rewards";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { commitPrivateRewardDocument } from "./canonical.js";
import { bytes32, demand, kindIndex, potIndex, uint } from "./validation.js";

const zeroHash = `0x${"0".repeat(64)}` as Hex;
export const rewardAwardAbiComponents = [
  { name: "entitlementId", type: "bytes32" }, { name: "beneficiaryId", type: "bytes32" },
  { name: "pot", type: "uint8" }, { name: "amount", type: "uint256" },
  { name: "explanationHash", type: "bytes32" }, { name: "beneficiaryKind", type: "uint8" },
] as const;
export type RewardPublicAward = {
  entitlementId: Hex; beneficiaryId: Hex; pot: 0 | 1; amount: bigint; explanationHash: Hex; beneficiaryKind: 0 | 1;
};
export type RewardPrivateBinding = {
  beneficiaryKind: "athlete" | "club"; beneficiaryId: string;
  opaqueBeneficiaryId: Hex; entitlementId: Hex; explanationSalt: Hex;
};
export type RewardCampaignCommitmentInput = {
  programmeId: Hex; campaignId: Hex; programmeManifestHash: Hex; snapshotDigest: Hex;
  latestPublicationAt: bigint;
};

function normalizedAward(award: RewardPublicAward): RewardPublicAward {
  demand(award.pot === 0 || award.pot === 1, "invalid_reward_pot");
  demand(award.beneficiaryKind === 0 || award.beneficiaryKind === 1, "invalid_reward_beneficiary_kind");
  demand(uint(award.amount) > 0n, "zero_reward_award");
  return { entitlementId: bytes32(award.entitlementId), beneficiaryId: bytes32(award.beneficiaryId), pot: award.pot,
    amount: award.amount, explanationHash: bytes32(award.explanationHash), beneficiaryKind: award.beneficiaryKind };
}

/** Public upload rows only. Exact order matters to Solidity's rolling hash. */
export function rewardUploadDigest(awards: readonly RewardPublicAward[], pot: 0 | 1, budget: bigint) {
  demand(pot === 0 || pot === 1, "invalid_reward_pot");
  uint(budget);
  let digest = zeroHash;
  let previous = zeroHash;
  let total = 0n;
  const beneficiaries = new Set<string>();
  for (const row of awards) {
    const award = normalizedAward(row);
    demand(award.pot === pot, "mixed_reward_pots");
    demand(award.entitlementId > previous, "reward_upload_order_or_duplicate");
    demand(!beneficiaries.has(award.beneficiaryId), "duplicate_opaque_beneficiary");
    beneficiaries.add(award.beneficiaryId);
    total += award.amount;
    demand(total <= budget, "reward_upload_over_budget");
    digest = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "tuple", components: rewardAwardAbiComponents }], [digest, award]));
    previous = award.entitlementId;
  }
  return { digest, total, count: BigInt(awards.length) };
}

export function rewardAllocationCommitment(input: RewardCampaignCommitmentInput & {
  awards: readonly RewardPublicAward[]; enabledPot: 0 | 1; budget: bigint;
}) {
  const programmeId = bytes32(input.programmeId);
  const campaignId = bytes32(input.campaignId);
  const programmeManifestHash = bytes32(input.programmeManifestHash);
  const snapshotDigest = bytes32(input.snapshotDigest);
  const latestPublicationAt = uint(input.latestPublicationAt, 64);
  demand(latestPublicationAt > 0n, "invalid_reward_publication_time");
  const awards = input.awards.map(normalizedAward);
  const upload = rewardUploadDigest(awards, input.enabledPot, input.budget);
  const budgets: [bigint, bigint] = input.enabledPot === 0 ? [input.budget, 0n] : [0n, input.budget];
  const allocated: [bigint, bigint] = input.enabledPot === 0 ? [upload.total, 0n] : [0n, upload.total];
  const allocationDigest = keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint8" },
    { type: "uint256[2]" }, { type: "uint256[2]" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" },
  ], [programmeId, campaignId, programmeManifestHash, snapshotDigest, input.enabledPot, budgets, allocated,
    upload.digest, upload.count, latestPublicationAt]));
  return { programmeId, campaignId, programmeManifestHash, snapshotDigest, latestPublicationAt,
    enabledPot: input.enabledPot, budgets, allocated, awards, uploadDigest: upload.digest,
    entitlementCount: upload.count, allocationDigest, unallocated: input.budget - upload.total };
}

/** Converts reviewed domain allocation + privately persisted random identifiers to
 *  a public-only upload. It never creates wallets/keys or publishes profile IDs.
 *  Snapshot approval/freshness and random-ID provenance are service responsibilities. */
export function prepareRewardCampaignUpload(result: RewardAllocationResult, input: RewardCampaignCommitmentInput, bindings: readonly RewardPrivateBinding[]) {
  const aggregates = aggregateRewardEntitlements(result);
  const bindingByBeneficiary = new Map<string, RewardPrivateBinding>();
  const usedSalts = new Set<string>();
  for (const binding of bindings) {
    kindIndex(binding.beneficiaryKind);
    demand(typeof binding.beneficiaryId === "string" && binding.beneficiaryId.length > 0, "missing_reward_private_beneficiary");
    const key = JSON.stringify([binding.beneficiaryKind, binding.beneficiaryId]);
    demand(!bindingByBeneficiary.has(key), "duplicate_reward_private_binding");
    const salt = bytes32(binding.explanationSalt);
    demand(!usedSalts.has(salt), "reused_reward_explanation_salt");
    usedSalts.add(salt);
    bindingByBeneficiary.set(key, binding);
  }
  demand(bindings.length === aggregates.length, "reward_binding_set_mismatch");
  const awards = aggregates.map((entitlement) => {
    const binding = bindingByBeneficiary.get(JSON.stringify([entitlement.beneficiaryKind, entitlement.beneficiaryId]));
    demand(binding, "missing_reward_private_binding");
    return { entitlementId: bytes32(binding.entitlementId), beneficiaryId: bytes32(binding.opaqueBeneficiaryId),
      pot: potIndex(entitlement.pot), amount: entitlement.amountWei, beneficiaryKind: kindIndex(entitlement.beneficiaryKind),
      explanationHash: commitPrivateRewardDocument("explanation", entitlement, binding.explanationSalt) };
  }).sort((a, b) => a.entitlementId < b.entitlementId ? -1 : a.entitlementId > b.entitlementId ? 1 : 0);
  return rewardAllocationCommitment({ ...input, awards, enabledPot: potIndex(result.pot), budget: result.budgetWei });
}

export function rewardUploadBatches(awards: readonly RewardPublicAward[], size = 64): RewardPublicAward[][] {
  demand(Number.isSafeInteger(size) && size > 0 && size <= 64, "invalid_reward_upload_batch_size");
  const result: RewardPublicAward[][] = [];
  for (let index = 0; index < awards.length; index += size) result.push(awards.slice(index, index + size).map(normalizedAward));
  return result;
}
