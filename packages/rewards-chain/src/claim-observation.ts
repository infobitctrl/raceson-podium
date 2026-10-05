import type { Address, Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { rewardAllocationCommitment } from "./allocation.js";
import { canonicalRewardJson } from "./canonical.js";
import { readVerifiedRewardCampaign, type RewardCampaignReader } from "./campaign-checkpoint.js";
import { normalizeRewardDeployment, type RewardDeploymentExpectation } from "./deployment.js";
import type { RewardLifecycleUpload } from "./lifecycle.js";
import { bytes32, demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

/** Internal common award/package observation. Public entry points separately
 * enforce athlete EOA or club Safe policy; this module is not a package export. */
export type RewardClaimExpectation = {
  deployment: RewardDeploymentExpectation; upload: RewardLifecycleUpload; entitlementId: Hex; recipient: Address;
};
export function normalizeRewardClaimExpectation<K extends 0 | 1>(input: RewardClaimExpectation, kind: K) {
  demand(kind === 0 || kind === 1, "invalid_reward_beneficiary_kind");
  const deployment = normalizeRewardDeployment(input.deployment), raw = input.upload;
  demand(Array.isArray(raw.budgets) && raw.budgets.length === 2 && raw.enabledPot === deployment.enabledPot, "reward_claim_package_mismatch");
  const upload = rewardAllocationCommitment({ ...raw, budget: uint(raw.budgets[raw.enabledPot]) });
  const storedCore = Object.fromEntries(Object.keys(upload).map(key => [key, raw[key as keyof typeof raw]]));
  demand(canonicalRewardJson(upload) === canonicalRewardJson(storedCore) && upload.programmeId === deployment.programmeId
    && upload.campaignId === deployment.campaignId && upload.programmeManifestHash === deployment.programmeManifestHash, "reward_claim_package_mismatch");
  const entitlementId = bytes32(input.entitlementId), recipient = walletAddress(input.recipient);
  const award = upload.awards.find(row => row.entitlementId === entitlementId);
  demand(award && award.beneficiaryKind === kind, kind === 0 ? "reward_athlete_claim_required" : "reward_club_claim_required");
  return { deployment, upload, entitlementId, recipient, award: { ...award, beneficiaryKind: kind } };
}

/** Does not establish club-recipient suitability. Only the club wrapper may
 * return a club witness after independently verifying its reviewed Safe. */
export async function readRewardClaimAward<K extends 0 | 1>(reader: RewardCampaignReader,
  expected: ReturnType<typeof normalizeRewardClaimExpectation<K>>, creationCode: Hex) {
  try {
    const checkpoint = await readVerifiedRewardCampaign(reader, expected.deployment, creationCode);
    const a = checkpoint.observation.accounting, f = checkpoint.observation.finalizedBlock, u = expected.upload, pot = u.enabledPot;
    demand(a.state === 3 && !a.paused && f.timestamp < a.claimDeadline, "reward_claim_campaign_unavailable");
    demand(a.accountedFunding === u.budgets[pot] && a.budgets[pot] === u.budgets[pot] && a.allocated[pot] === u.allocated[pot]
      && a.entitlementCount === u.entitlementCount && a.uploadDigest === u.uploadDigest && a.snapshotDigest === u.snapshotDigest
      && a.allocationDigest === u.allocationDigest && f.timestamp >= a.activationNotBefore
      && a.activationNotBefore >= u.latestPublicationAt + 259200n, "reward_claim_package_mismatch");
    const [row, operatorCode, recipientCode] = await Promise.all([
      reader.readContract({ address: expected.deployment.context.verifyingContract, abi: rewardCampaignAbi,
        functionName: "entitlements", args: [expected.entitlementId], blockNumber: f.number }),
      reader.getCode({ address: expected.deployment.operatorAddress, blockNumber: f.number }),
      reader.getCode({ address: expected.recipient, blockNumber: f.number }),
    ]);
    demand(operatorCode === undefined || operatorCode === "0x", "reward_claim_eoa_operator_required");
    if (expected.award.beneficiaryKind === 0) demand(recipientCode === undefined || recipientCode === "0x", "reward_claim_eoa_recipient_required");
    const [beneficiaryId, amount, explanationHash, nonce, recipient, potIndex, paid, kind] = row;
    demand(bytes32(beneficiaryId) === expected.award.beneficiaryId && amount === expected.award.amount
      && bytes32(explanationHash) === expected.award.explanationHash && potIndex === pot && kind === expected.award.beneficiaryKind, "reward_claim_award_mismatch");
    demand(paid === false && /^0x0{40}$/i.test(recipient), "reward_claim_already_paid");
    uint(nonce); demand(nonce < (1n << 256n) - 1n, "reward_claim_nonce_exhausted");
    const [chainAfter, finalityAfter, canonicalAfter] = await Promise.all([
      reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber: f.number }),
    ]);
    demand(chainAfter === expected.deployment.context.chainId, "reward_observed_chain_mismatch");
    demand(finalityAfter.number !== null && finalityAfter.hash !== null && finalityAfter.number >= f.number, "reward_finality_regressed");
    demand(canonicalAfter.number === f.number && canonicalAfter.hash !== null && bytes32(canonicalAfter.hash) === f.hash
      && canonicalAfter.timestamp === f.timestamp && (finalityAfter.number !== f.number || bytes32(finalityAfter.hash) === f.hash), "reward_chain_changed_during_observation");
    return { ...checkpoint, award: { ...expected.award, nonce, paid: false as const }, recipient: expected.recipient.toLowerCase() as Address };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_claim_observation_unavailable");
  }
}
