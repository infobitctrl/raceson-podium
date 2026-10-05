import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { canonicalRewardJson } from "./canonical.js";
import { validateRewardCampaignAccounting, type RewardCampaignAccounting } from "./campaign-checkpoint.js";
import { requireRewardReviewClockV3, rewardAllocationCommitmentV3, rewardCampaignV3Abi as abi } from "./campaign-v3.js";
import { readVerifiedRewardDeploymentV3, type RewardDeploymentReaderV3 } from "./deployment-reader-v3.js";
import { normalizeRewardDeploymentV3, rewardCampaignV3Build, verifyRewardRuntimeV3, type RewardDeploymentExpectationV3, type RewardDeploymentSpecV3 } from "./deployment-v3.js";
import { normalizeRewardProgrammeV3, readVerifiedRewardProgrammeV3, rewardProgrammeChildV3, type RewardProgrammeExpectationV3 } from "./programme-v3.js";
import { bytes32, demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

export type RewardAthleteClaimExpectationV3 = {
  protocolVersion: 3;
  deployment: RewardDeploymentExpectationV3;
  upload: ReturnType<typeof rewardAllocationCommitmentV3>;
  stageTransactionHash: Hex;
  entitlementId: Hex;
  recipient: Address;
};
export type RewardClaimReaderV3 = RewardDeploymentReaderV3 & Pick<PublicClient, "readContract" | "getBalance">;
export type RewardProgrammeAthleteClaimExpectationV3 = Omit<RewardAthleteClaimExpectationV3, "deployment"> & {
  programme: RewardProgrammeExpectationV3;
  /** Zero-based: 0–4 race pots, 5 league. Not an arbitrary campaign address. */
  slot: number;
};

/** Stored authoritative package only, never browser-selected amounts, publication
 * times or evidence. V3 tags and immutable review policy must agree throughout;
 * historical V1/V2 commitments cannot enter by changing only the outer tag. */
export function normalizeRewardAthleteClaimExpectationV3(input: RewardAthleteClaimExpectationV3) {
  demand(input.protocolVersion === 3, "wrong_reward_claim_protocol");
  const deployment = normalizeRewardDeploymentV3(input.deployment);
  return { ...normalizeClaimPackageV3(input, deployment, 0), deployment };
}

/** Factory children must derive from the exact saved programme, never be
 * disguised as an operator CREATE or accepted by a caller-supplied address. */
export function normalizeRewardProgrammeAthleteClaimExpectationV3(input: RewardProgrammeAthleteClaimExpectationV3) {
  return normalizeProgrammeAwardV3(input, 0);
}

/** Internal club award boundary, not Safe verification or permission to claim.
 * Only the club reader composes this with reviewed original-Safe provenance. */
export function normalizeRewardProgrammeClubAwardV3(input: RewardProgrammeAthleteClaimExpectationV3) {
  return normalizeProgrammeAwardV3(input, 1);
}
function normalizeProgrammeAwardV3<K extends 0 | 1>(input: RewardProgrammeAthleteClaimExpectationV3, kind: K) {
  demand(input.protocolVersion === 3, "wrong_reward_claim_protocol");
  const programme = normalizeRewardProgrammeV3(input.programme), slot = input.slot;
  const deployment = rewardProgrammeChildV3(programme, slot), normalized = normalizeClaimPackageV3(input, deployment, kind);
  demand(normalized.upload.budgets[deployment.enabledPot] === deployment.budgetWei, "reward_claim_package_mismatch");
  return { ...normalized, programme, slot, deployment };
}

function normalizeClaimPackageV3<K extends 0 | 1>(input: Omit<RewardAthleteClaimExpectationV3, "deployment">, deployment: RewardDeploymentSpecV3, kind: K) {
  const raw = input.upload;
  demand(raw.protocolVersion === 3, "wrong_reward_claim_protocol");
  demand(Array.isArray(raw.awards) && raw.awards.length <= 20000 && Array.isArray(raw.budgets)
    && raw.budgets.length === 2 && raw.enabledPot === deployment.enabledPot
    && raw.reviewPeriod === deployment.reviewPeriod, "reward_claim_package_mismatch");
  const budget = uint(raw.budgets[raw.enabledPot]);
  demand(budget > 0n, "reward_claim_package_mismatch");
  const upload = rewardAllocationCommitmentV3({ ...raw, budget });
  const storedCore = Object.fromEntries(Object.keys(upload).map(key => [key, raw[key as keyof typeof raw]]));
  demand(canonicalRewardJson(upload) === canonicalRewardJson(storedCore) && upload.programmeId === deployment.programmeId
    && upload.campaignId === deployment.campaignId && upload.programmeManifestHash === deployment.programmeManifestHash,
  "reward_claim_package_mismatch");
  const stageTransactionHash = bytes32(input.stageTransactionHash), entitlementId = bytes32(input.entitlementId);
  const recipient = walletAddress(input.recipient), award = upload.awards.find(row => row.entitlementId === entitlementId);
  demand(award && award.beneficiaryKind === kind, kind === 0 ? "reward_athlete_claim_required" : "reward_club_claim_required");
  return { protocolVersion: 3 as const, deployment, upload, stageTransactionHash, entitlementId, recipient,
    award: { ...award, beneficiaryKind: kind } };
}

/** Read-only V3 EOA checkpoint: exact deployment, full funded package, canonical
 * AllocationStaged + FinalResultsApproved receipt and unpaid award/nonce, all at
 * one finalized block. Approval follows completed platform review; no second
 * chain timer is invented. This verifies an operator attestation, not sporting
 * truth, profile ownership, age, wallet control, consent or authority to send.
 * Reobserve before approval/execution; a witness is not a lease on chain state. */
export async function readVerifiedRewardAthleteClaimV3(reader: RewardClaimReaderV3,
  input: RewardAthleteClaimExpectationV3, creationCode: Hex) {
  try {
    const expected = normalizeRewardAthleteClaimExpectationV3(input), d = expected.deployment;
    const verified = await readVerifiedRewardDeploymentV3(reader, d, creationCode);
    const claim = await readClaimAtVerifiedDeployment(reader, expected, { ...verified, operatorDeploymentNonce: d.deploymentNonce });
    return { protocolVersion: 3 as const,
      deployment: { schemaVersion: 3 as const, protocolVersion: 3 as const, chainId: d.context.chainId,
        contractAddress: d.context.verifyingContract.toLowerCase() as Address, buildId: verified.buildId, creationCodeHash: verified.creationCodeHash,
        runtimeCodeHash: verified.runtimeCodeHash, deploymentTransactionHash: d.deploymentTransactionHash, deploymentNonce: d.deploymentNonce,
        deploymentBlockNumber: verified.deploymentBlockNumber, deploymentBlockHash: verified.deploymentBlockHash }, ...claim };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_claim_observation_unavailable");
  }
}

/** Full parent CREATE/events/runtime/funding and child runtime verification,
 * followed by the same exact package/publication/unpaid-EOA checks as the trial.
 * Explicit factory provenance is not a direct-deployment witness and cannot be
 * submitted to the legacy claim store. No approval, identity or send capability. */
export async function readVerifiedRewardProgrammeAthleteClaimV3(reader: RewardClaimReaderV3,
  input: RewardProgrammeAthleteClaimExpectationV3) {
  const result = await readProgrammeAwardV3(reader, input, "unpaid", 0);
  return { ...result, award: { ...result.award, paid: false as const } };
}

/** Historical paid-award checkpoint only, never eligibility to sign or send.
 * Pausing, expiry or normal closure cannot erase a successful payment. Exact
 * transaction/receipt and receipt-time EOA checks are the payment reader's job. */
export async function readVerifiedRewardProgrammePaidAthleteV3(reader: RewardClaimReaderV3,
  input: RewardProgrammeAthleteClaimExpectationV3) {
  const result = await readProgrammeAwardV3(reader, input, "paid", 0);
  return { ...result, award: { ...result.award, paid: true as const } };
}

/** Internal accounting observation only. Deliberately not exported from the
 * package barrel: it does NOT verify the club's Safe or any recipient consent. */
export async function readRewardProgrammeClubAwardV3(reader: RewardClaimReaderV3,
  input: RewardProgrammeAthleteClaimExpectationV3, mode: "unpaid" | "paid") {
  demand(mode === "unpaid" || mode === "paid", "invalid_reward_claim_observation_mode");
  return readProgrammeAwardV3(reader, input, mode, 1);
}
async function readProgrammeAwardV3<K extends 0 | 1>(reader: RewardClaimReaderV3,
  input: RewardProgrammeAthleteClaimExpectationV3, mode: "unpaid" | "paid", kind: K) {
  try {
    const expected = normalizeProgrammeAwardV3(input, kind);
    const verified = await readVerifiedRewardProgrammeV3(reader, expected.programme), pot = verified.pots[expected.slot]!;
    demand(pot.routed && pot.accountedFundingWei === expected.deployment.budgetWei, "reward_claim_package_mismatch");
    const runtime = await reader.getCode({ address: expected.deployment.context.verifyingContract, blockNumber: verified.finalizedBlock.number });
    demand(runtime !== undefined, "reward_deployment_code_missing");
    const runtimeCodeHash = verifyRewardRuntimeV3(expected.deployment, runtime);
    const claim = await readClaimAtVerifiedDeployment(reader, expected,
      { ...verified, operatorDeploymentNonce: expected.programme.deploymentNonce }, mode);
    return { protocolVersion: 3 as const,
      provenance: { kind: "programme-child" as const, programme: expected.programme, slot: expected.slot,
        programmeRuntimeCodeHash: verified.runtimeCodeHash, campaignBuildId: rewardCampaignV3Build.id,
        campaignRuntimeCodeHash: runtimeCodeHash, deploymentBlockNumber: verified.deploymentBlockNumber,
        deploymentBlockHash: verified.deploymentBlockHash }, campaign: expected.deployment, ...claim };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    throw new RewardProtocolError("reward_claim_observation_unavailable");
  }
}

type ClaimAnchor = { finalizedBlock: { number: bigint; hash: Hex; timestamp: bigint };
  deploymentBlockNumber: bigint; deploymentBlockHash: Hex; operatorDeploymentNonce: bigint };
async function readClaimAtVerifiedDeployment<K extends 0 | 1>(reader: RewardClaimReaderV3,
  expected: ReturnType<typeof normalizeClaimPackageV3<K>>, verified: ClaimAnchor, mode: "unpaid" | "paid" = "unpaid") {
    const d = expected.deployment, u = expected.upload;
    const f = verified.finalizedBlock, address = d.context.verifyingContract, blockNumber = f.number, pot = u.enabledPot;
    const scalarNames = ["state", "paused", "accountedFunding", "treasuryReturned", "entitlementCount", "uploadDigest",
      "snapshotDigest", "allocationDigest", "activationNotBefore", "claimDeadline", "pausedAt"] as const;
    const readPair = async (functionName: "budgets" | "allocated" | "paid") => Promise.all([0n, 1n].map(index =>
      reader.readContract({ address, abi, functionName, args: [index], blockNumber }))) as Promise<[bigint, bigint]>;
    const [scalars, budgets, allocated, paid, nativeBalance, protocolVersion, reviewPeriod, reviewStartedAt,
      officialPublishedAt, publicationEvidenceHash, row, operatorCode, recipientCode, tx, receipt] = await Promise.all([
      Promise.all(scalarNames.map(functionName => reader.readContract({ address, abi, functionName, blockNumber }))),
      readPair("budgets"), readPair("allocated"), readPair("paid"), reader.getBalance({ address, blockNumber }),
      reader.readContract({ address, abi, functionName: "PROTOCOL_VERSION", blockNumber }),
      reader.readContract({ address, abi, functionName: "reviewPeriod", blockNumber }),
      reader.readContract({ address, abi, functionName: "reviewStartedAt", blockNumber }),
      reader.readContract({ address, abi, functionName: "officialPublishedAt", blockNumber }),
      reader.readContract({ address, abi, functionName: "publicationEvidenceHash", blockNumber }),
      reader.readContract({ address, abi, functionName: "entitlements", args: [expected.entitlementId], blockNumber }),
      reader.getCode({ address: d.operatorAddress, blockNumber }), reader.getCode({ address: expected.recipient, blockNumber }),
      reader.getTransaction({ hash: expected.stageTransactionHash }), reader.getTransactionReceipt({ hash: expected.stageTransactionHash }),
    ]);
    const scalar = Object.fromEntries(scalarNames.map((name, index) => [name, scalars[index]])) as Pick<RewardCampaignAccounting, typeof scalarNames[number]>;
    const a = validateRewardCampaignAccounting({ ...scalar, budgets, allocated, paid, nativeBalance }, pot);
    demand(mode === "paid" ? [3, 4].includes(a.state) : a.state === 3 && !a.paused && f.timestamp < a.claimDeadline,
      "reward_claim_campaign_unavailable");
    demand(a.accountedFunding === u.budgets[pot] && a.budgets[pot] === u.budgets[pot] && a.allocated[pot] === u.allocated[pot]
      && a.entitlementCount === u.entitlementCount && a.uploadDigest === u.uploadDigest && a.snapshotDigest === u.snapshotDigest
      && a.allocationDigest === u.allocationDigest, "reward_claim_package_mismatch");

    const stageNumber = uint(receipt.blockNumber), stageHash = bytes32(receipt.blockHash), hash = expected.stageTransactionHash;
    demand(stageNumber >= verified.deploymentBlockNumber && stageNumber <= f.number, "reward_claim_stage_not_finalized");
    demand(receipt.status === "success" && bytes32(receipt.transactionHash) === hash && bytes32(tx.hash) === hash
      && tx.chainId === d.context.chainId && tx.blockNumber === stageNumber && tx.blockHash !== null && bytes32(tx.blockHash) === stageHash
      && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex,
    "reward_claim_stage_receipt_mismatch");
    demand(tx.to !== null && receipt.to !== null && walletAddress(tx.to) === address && walletAddress(receipt.to) === address
      && receipt.contractAddress === null && walletAddress(tx.from) === d.operatorAddress && walletAddress(receipt.from) === d.operatorAddress
      && Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce) > verified.operatorDeploymentNonce && tx.value === 0n
      && tx.input.toLowerCase() === encodeFunctionData({ abi, functionName: "stageAllocation", args: [u.snapshotDigest,
        u.uploadDigest, u.entitlementCount, u.reviewStartedAt, u.officialPublishedAt, u.publicationEvidenceHash] }),
    "reward_claim_stage_transaction_mismatch");
    const stageBlock = await reader.getBlock({ blockNumber: stageNumber });
    demand(stageBlock.number === stageNumber && stageBlock.hash !== null && bytes32(stageBlock.hash) === stageHash
      && uint(stageBlock.timestamp) <= f.timestamp && (stageNumber !== f.number || (stageHash === f.hash && stageBlock.timestamp === f.timestamp)),
    "reward_claim_stage_not_canonical");
    const review = requireRewardReviewClockV3({ protocolVersion, reviewPeriod, reviewStartedAt, officialPublishedAt,
      publicationEvidenceHash, stageBlockTimestamp: stageBlock.timestamp, activationNotBefore: a.activationNotBefore });
    demand(review.reviewPeriod === u.reviewPeriod && review.reviewStartedAt === u.reviewStartedAt
      && review.officialPublishedAt === u.officialPublishedAt && review.publicationEvidenceHash === u.publicationEvidenceHash,
    "reward_claim_publication_mismatch");
    demand(f.timestamp >= review.activationNotBefore, "reward_claim_review_not_finished");
    const events = [
      { topics: encodeEventTopics({ abi, eventName: "AllocationStaged", args: { allocationDigest: u.allocationDigest, snapshotDigest: u.snapshotDigest } }),
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [u.entitlementCount, review.activationNotBefore]) },
      { topics: encodeEventTopics({ abi, eventName: "FinalResultsApproved", args: {
        allocationDigest: u.allocationDigest, publicationEvidenceHash: u.publicationEvidenceHash } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [review.reviewStartedAt, review.reviewPeriod, review.officialPublishedAt, review.activationNotBefore]) },
    ];
    demand(Array.isArray(receipt.logs) && receipt.logs.length === events.length, "reward_claim_stage_event_mismatch");
    for (const [index, event] of events.entries()) {
      const log = receipt.logs[index];
      demand(log.removed === false && log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0
        && (index === 0 || log.logIndex === receipt.logs[index - 1]!.logIndex! + 1)
        && log.transactionHash === hash && log.transactionIndex === receipt.transactionIndex && log.blockNumber === stageNumber && log.blockHash === stageHash
        && walletAddress(log.address) === address && log.data.toLowerCase() === event.data && log.topics.length === event.topics.length
        && log.topics.every((topic, i) => topic.toLowerCase() === event.topics[i]), "reward_claim_stage_event_mismatch");
    }

    // EIP-7702 delegated accounts are contract accounts for this EOA-only flow.
    if (mode === "unpaid") {
      demand(operatorCode === undefined || operatorCode === "0x", "reward_claim_eoa_operator_required");
      if (expected.award.beneficiaryKind === 0)
        demand(recipientCode === undefined || recipientCode === "0x", "reward_claim_eoa_recipient_required");
    }
    demand(Array.isArray(row) && row.length === 8, "reward_claim_award_mismatch");
    const [beneficiaryId, amount, explanationHash, nonce, recipient, potIndex, isPaid, kind] = row;
    demand(bytes32(beneficiaryId) === expected.award.beneficiaryId && amount === expected.award.amount
      && bytes32(explanationHash) === expected.award.explanationHash && potIndex === pot && kind === expected.award.beneficiaryKind, "reward_claim_award_mismatch");
    if (mode === "paid") {
      demand(isPaid === true && walletAddress(recipient) === expected.recipient && nonce > 0n, "reward_payment_award_mismatch");
    } else {
      demand(isPaid === false && typeof recipient === "string" && /^0x0{40}$/i.test(recipient), "reward_claim_already_paid");
      demand(nonce < (1n << 256n) - 1n, "reward_claim_nonce_exhausted");
    }
    uint(nonce);
    const [chainAfter, finalityAfter, canonicalAfter, stageAfter, deploymentAfter] = await Promise.all([
      reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber }),
      reader.getBlock({ blockNumber: stageNumber }), reader.getBlock({ blockNumber: verified.deploymentBlockNumber }),
    ]);
    demand(chainAfter === d.context.chainId, "reward_observed_chain_mismatch");
    demand(finalityAfter.number !== null && finalityAfter.hash !== null && uint(finalityAfter.number) >= blockNumber
      && uint(finalityAfter.timestamp) >= f.timestamp, "reward_finality_regressed");
    demand(canonicalAfter.number === blockNumber && canonicalAfter.hash !== null && bytes32(canonicalAfter.hash) === f.hash
      && canonicalAfter.timestamp === f.timestamp && (finalityAfter.number !== blockNumber || bytes32(finalityAfter.hash) === f.hash)
      && stageAfter.number === stageNumber && stageAfter.hash !== null && bytes32(stageAfter.hash) === stageHash && stageAfter.timestamp === stageBlock.timestamp
      && deploymentAfter.number === verified.deploymentBlockNumber && deploymentAfter.hash !== null && bytes32(deploymentAfter.hash) === verified.deploymentBlockHash,
    "reward_chain_changed_during_observation");
    return {
      observation: { schemaVersion: 3 as const, protocolVersion: 3 as const, finalizedBlock: f, accounting: a,
        review: { ...review, stageTransactionHash: hash, stageBlockNumber: stageNumber, stageBlockHash: stageHash } },
      award: { ...expected.award, nonce, paid: mode === "paid" }, recipient: expected.recipient.toLowerCase() as Address };
}

export type RewardAthleteClaimWitnessV3 = Awaited<ReturnType<typeof readVerifiedRewardAthleteClaimV3>>;
export type RewardProgrammeAthleteClaimWitnessV3 = Awaited<ReturnType<typeof readVerifiedRewardProgrammeAthleteClaimV3>>;
