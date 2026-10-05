import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { rewardAllocationCommitment } from "./allocation.js";
import { canonicalRewardJson } from "./canonical.js";
import { validateRewardCampaignAccounting, type RewardCampaignAccounting } from "./campaign-checkpoint.js";
import { requireRewardReviewClockV2, rewardCampaignV2Abi as abi } from "./campaign-v2.js";
import { readVerifiedRewardDeploymentV2, type RewardDeploymentReaderV2 } from "./deployment-reader-v2.js";
import { normalizeRewardDeploymentV2, type RewardDeploymentExpectationV2 } from "./deployment-v2.js";
import { bytes32, demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

export type RewardAthleteClaimExpectationV2 = {
  protocolVersion: 2;
  deployment: RewardDeploymentExpectationV2;
  upload: ReturnType<typeof rewardAllocationCommitment>;
  stageTransactionHash: Hex;
  entitlementId: Hex;
  recipient: Address;
};
export type RewardClaimReaderV2 = RewardDeploymentReaderV2 & Pick<PublicClient, "readContract" | "getBalance">;

/** Trusted stored package, not browser-selected amounts or signing domains.
 * Explicit V2 input/output tags keep this out of the historical V1 claim path. */
export function normalizeRewardAthleteClaimExpectationV2(input: RewardAthleteClaimExpectationV2) {
  demand(input.protocolVersion === 2, "wrong_reward_claim_protocol");
  const deployment = normalizeRewardDeploymentV2(input.deployment), raw = input.upload;
  demand(Array.isArray(raw.awards) && raw.awards.length <= 20000 && Array.isArray(raw.budgets)
    && raw.budgets.length === 2 && raw.enabledPot === deployment.enabledPot, "reward_claim_package_mismatch");
  const budget = uint(raw.budgets[raw.enabledPot]);
  demand(budget > 0n, "reward_claim_package_mismatch");
  const upload = rewardAllocationCommitment({ ...raw, budget });
  const storedCore = Object.fromEntries(Object.keys(upload).map(key => [key, raw[key as keyof typeof raw]]));
  demand(canonicalRewardJson(upload) === canonicalRewardJson(storedCore) && upload.programmeId === deployment.programmeId
    && upload.campaignId === deployment.campaignId && upload.programmeManifestHash === deployment.programmeManifestHash,
  "reward_claim_package_mismatch");
  const stageTransactionHash = bytes32(input.stageTransactionHash), entitlementId = bytes32(input.entitlementId);
  const recipient = walletAddress(input.recipient), award = upload.awards.find(row => row.entitlementId === entitlementId);
  demand(award && award.beneficiaryKind === 0, "reward_athlete_claim_required");
  return { protocolVersion: 2 as const, deployment, upload, stageTransactionHash, entitlementId, recipient,
    award: { ...award, beneficiaryKind: 0 as const } };
}

/** Read-only V2 worker checkpoint: pinned deployment, complete funded package,
 * actual canonical stage receipt and one 24h review, unpaid award and EOA code.
 * All current-state reads use one finalized block. No signer, RPC selection,
 * identity/age approval, wallet ownership, consent or permission to send.
 * Reobserve at approval/execution; this result is not a lease on chain state. */
export async function readVerifiedRewardAthleteClaimV2(reader: RewardClaimReaderV2,
  input: RewardAthleteClaimExpectationV2, creationCode: Hex) {
  try {
    // Capture the whole package and scalar inputs before the first await.
    const expected = normalizeRewardAthleteClaimExpectationV2(input), d = expected.deployment, u = expected.upload;
    const verified = await readVerifiedRewardDeploymentV2(reader, d, creationCode);
    const f = verified.finalizedBlock, address = d.context.verifyingContract, blockNumber = f.number, pot = u.enabledPot;
    const scalarNames = ["state", "paused", "accountedFunding", "treasuryReturned", "entitlementCount", "uploadDigest",
      "snapshotDigest", "allocationDigest", "activationNotBefore", "claimDeadline", "pausedAt"] as const;
    const readPair = async (functionName: "budgets" | "allocated" | "paid") => Promise.all([0n, 1n].map(index =>
      reader.readContract({ address, abi, functionName, args: [index], blockNumber }))) as Promise<[bigint, bigint]>;
    const [scalars, budgets, allocated, paid, nativeBalance, protocolVersion, period, reviewStartedAt, row, operatorCode, recipientCode, tx, receipt]
      = await Promise.all([
        Promise.all(scalarNames.map(functionName => reader.readContract({ address, abi, functionName, blockNumber }))),
        readPair("budgets"), readPair("allocated"), readPair("paid"), reader.getBalance({ address, blockNumber }),
        reader.readContract({ address, abi, functionName: "PROTOCOL_VERSION", blockNumber }),
        reader.readContract({ address, abi, functionName: "REVIEW_PERIOD", blockNumber }),
        reader.readContract({ address, abi, functionName: "reviewStartedAt", blockNumber }),
        reader.readContract({ address, abi, functionName: "entitlements", args: [expected.entitlementId], blockNumber }),
        reader.getCode({ address: d.operatorAddress, blockNumber }), reader.getCode({ address: expected.recipient, blockNumber }),
        reader.getTransaction({ hash: expected.stageTransactionHash }), reader.getTransactionReceipt({ hash: expected.stageTransactionHash }),
      ]);
    // Fixed ABI field names only; the shared economic validator checks runtime types.
    // Do not reuse V1 deployment/lifecycle readers or their historical 72h rule.
    const scalar = Object.fromEntries(scalarNames.map((name, index) => [name, scalars[index]])) as Pick<RewardCampaignAccounting, typeof scalarNames[number]>;
    const a = validateRewardCampaignAccounting({ ...scalar, budgets, allocated, paid, nativeBalance }, pot);
    demand(a.state === 3 && !a.paused && f.timestamp < a.claimDeadline, "reward_claim_campaign_unavailable");
    demand(a.accountedFunding === u.budgets[pot] && a.budgets[pot] === u.budgets[pot] && a.allocated[pot] === u.allocated[pot]
      && a.entitlementCount === u.entitlementCount && a.uploadDigest === u.uploadDigest && a.snapshotDigest === u.snapshotDigest
      && a.allocationDigest === u.allocationDigest, "reward_claim_package_mismatch");

    // The timestamp is from the exact successful staging transaction's block,
    // not an API/browser date or a getter used as its own evidence.
    const stageNumber = uint(receipt.blockNumber), stageHash = bytes32(receipt.blockHash), hash = expected.stageTransactionHash;
    demand(stageNumber >= verified.deploymentBlockNumber && stageNumber <= f.number, "reward_claim_stage_not_finalized");
    demand(receipt.status === "success" && bytes32(receipt.transactionHash) === hash && bytes32(tx.hash) === hash
      && tx.chainId === d.context.chainId && tx.blockNumber === stageNumber && tx.blockHash !== null && bytes32(tx.blockHash) === stageHash
      && Number.isSafeInteger(receipt.transactionIndex) && receipt.transactionIndex >= 0 && tx.transactionIndex === receipt.transactionIndex,
    "reward_claim_stage_receipt_mismatch");
    demand(tx.to !== null && receipt.to !== null && walletAddress(tx.to) === address && walletAddress(receipt.to) === address
      && receipt.contractAddress === null && walletAddress(tx.from) === d.operatorAddress && walletAddress(receipt.from) === d.operatorAddress
      && Number.isSafeInteger(tx.nonce) && BigInt(tx.nonce) > d.deploymentNonce && tx.value === 0n
      && tx.input.toLowerCase() === encodeFunctionData({ abi, functionName: "stageAllocation", args: [u.snapshotDigest,
        u.uploadDigest, u.entitlementCount, u.latestPublicationAt] }), "reward_claim_stage_transaction_mismatch");
    const stageBlock = await reader.getBlock({ blockNumber: stageNumber });
    demand(stageBlock.number === stageNumber && stageBlock.hash !== null && bytes32(stageBlock.hash) === stageHash
      && uint(stageBlock.timestamp) <= f.timestamp && (stageNumber !== f.number || (stageHash === f.hash && stageBlock.timestamp === f.timestamp)),
    "reward_claim_stage_not_canonical");
    const review = requireRewardReviewClockV2({ protocolVersion, period, reviewStartedAt, stageBlockTimestamp: stageBlock.timestamp,
      activationNotBefore: a.activationNotBefore, latestPublicationAt: u.latestPublicationAt });
    demand(f.timestamp >= review.activationNotBefore, "reward_claim_review_not_finished");
    const topics = encodeEventTopics({ abi, eventName: "AllocationStaged", args: { allocationDigest: u.allocationDigest, snapshotDigest: u.snapshotDigest } });
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [u.entitlementCount, review.activationNotBefore]);
    demand(Array.isArray(receipt.logs) && receipt.logs.length === 1, "reward_claim_stage_event_mismatch");
    const log = receipt.logs[0];
    demand(log.removed === false && log.logIndex !== null && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0
      && log.transactionHash === hash && log.transactionIndex === receipt.transactionIndex && log.blockNumber === stageNumber && log.blockHash === stageHash
      && walletAddress(log.address) === address && log.data.toLowerCase() === data && log.topics.length === topics.length
      && log.topics.every((topic, index) => topic.toLowerCase() === topics[index]), "reward_claim_stage_event_mismatch");

    // Contract wallets (including EIP-7702 delegation) must not enter this EOA path.
    demand(operatorCode === undefined || operatorCode === "0x", "reward_claim_eoa_operator_required");
    demand(recipientCode === undefined || recipientCode === "0x", "reward_claim_eoa_recipient_required");
    demand(Array.isArray(row) && row.length === 8, "reward_claim_award_mismatch");
    const [beneficiaryId, amount, explanationHash, nonce, recipient, potIndex, isPaid, kind] = row;
    demand(bytes32(beneficiaryId) === expected.award.beneficiaryId && amount === expected.award.amount
      && bytes32(explanationHash) === expected.award.explanationHash && potIndex === pot && kind === 0, "reward_claim_award_mismatch");
    demand(isPaid === false && typeof recipient === "string" && /^0x0{40}$/i.test(recipient), "reward_claim_already_paid");
    uint(nonce); demand(nonce < (1n << 256n) - 1n, "reward_claim_nonce_exhausted");
    const [chainAfter, finalityAfter, canonicalAfter, stageAfter, deploymentAfter] = await Promise.all([
      reader.getChainId(), reader.getBlock({ blockTag: "finalized" }), reader.getBlock({ blockNumber }),
      reader.getBlock({ blockNumber: stageNumber }), reader.getBlock({ blockNumber: verified.deploymentBlockNumber }),
    ]);
    demand(chainAfter === d.context.chainId, "reward_observed_chain_mismatch");
    demand(finalityAfter.number !== null && finalityAfter.hash !== null && uint(finalityAfter.number) >= blockNumber, "reward_finality_regressed");
    demand(canonicalAfter.number === blockNumber && canonicalAfter.hash !== null && bytes32(canonicalAfter.hash) === f.hash
      && canonicalAfter.timestamp === f.timestamp && (finalityAfter.number !== blockNumber || bytes32(finalityAfter.hash) === f.hash)
      && stageAfter.number === stageNumber && stageAfter.hash !== null && bytes32(stageAfter.hash) === stageHash && stageAfter.timestamp === stageBlock.timestamp
      && deploymentAfter.number === verified.deploymentBlockNumber && deploymentAfter.hash !== null && bytes32(deploymentAfter.hash) === verified.deploymentBlockHash,
    "reward_chain_changed_during_observation");
    return { protocolVersion: 2 as const,
      deployment: { schemaVersion: 2 as const, protocolVersion: 2 as const, chainId: d.context.chainId,
        contractAddress: address.toLowerCase() as Address, buildId: verified.buildId, creationCodeHash: verified.creationCodeHash,
        runtimeCodeHash: verified.runtimeCodeHash, deploymentTransactionHash: d.deploymentTransactionHash, deploymentNonce: d.deploymentNonce,
        deploymentBlockNumber: verified.deploymentBlockNumber, deploymentBlockHash: verified.deploymentBlockHash },
      observation: { schemaVersion: 2 as const, protocolVersion: 2 as const, finalizedBlock: f, accounting: a,
        review: { ...review, stageTransactionHash: hash, stageBlockNumber: stageNumber, stageBlockHash: stageHash } },
      award: { ...expected.award, nonce, paid: false as const }, recipient: expected.recipient.toLowerCase() as Address };
  } catch (error) {
    if (error instanceof RewardProtocolError) throw error;
    // Never expose authenticated RPC endpoints, causes or provider responses.
    throw new RewardProtocolError("reward_claim_observation_unavailable");
  }
}
