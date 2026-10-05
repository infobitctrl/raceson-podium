import { getContractAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardProgrammeChildV3 } from "../dist/programme-v3.js";
import { rewardUploadDigest } from "../dist/allocation.js";

// Synthetic local test actors only. No externally provided key or endpoint.
export const lifecycleOperator = privateKeyToAccount(toHex(0xA11CEn, { size: 32 }));
export const lifecycleStranger = privateKeyToAccount(toHex(0xB0Bn, { size: 32 }));
export const h = n => toHex(BigInt(n), { size: 32 });
export const lifecycleFees = { gasLimit: 15000000n, maxFeePerGas: 30000000000n, maxPriorityFeePerGas: 1000000000n, maxGasCostWei: 450000000000000000n };
export function publicPackage(programme, slot, awards, snapshotDigest = h(100)) {
  const child = rewardProgrammeChildV3(programme, slot), r = rewardUploadDigest(awards, child.enabledPot, child.budgetWei);
  return { schema: "raceson-award-upload-v3", protocolVersion: 3, chainId: programme.context.chainId,
    programmeAddress: programme.context.verifyingContract.toLowerCase(), campaignAddress: child.context.verifyingContract.toLowerCase(),
    deploymentTransactionHash: programme.deploymentTransactionHash, programmeId: child.programmeId, campaignId: child.campaignId,
    programmeManifestHash: child.programmeManifestHash, enabledPot: child.enabledPot, reviewPeriod: child.reviewPeriod.toString(),
    budgetWei: child.budgetWei.toString(), allocatedWei: r.total.toString(), unallocatedWei: (child.budgetWei - r.total).toString(),
    snapshotDigest, uploadDigest: r.digest, entitlementCount: r.count.toString(), awards: awards.map(r => ({ ...r, amount: r.amount.toString() })) };
}
export function lifecyclePlan(action = "upload_awards", slot = 0, count = 2) {
  const programme = { context: { environment: "local-simulation", chainId: 31337,
    verifyingContract: getContractAddress({ from: lifecycleOperator.address, nonce: 3n }) }, operatorAddress: lifecycleOperator.address,
    funderAddress: lifecycleStranger.address, programmeId: h(10), programmeManifestHash: h(11), budgetWei: 100n * 10n ** 18n,
    campaignIds: Array.from({ length: 6 }, (_, i) => h(20 + i)), reviewPeriods: [86400n, 3600n, 0n, 0n, 0n, 0n],
    deploymentTransactionHash: h(30), deploymentNonce: 3n };
  const child = rewardProgrammeChildV3(programme, slot);
  const awards = Array.from({ length: count }, (_, i) => ({ entitlementId: h(1000 + i), beneficiaryId: h(2000 + i),
    explanationHash: h(3000 + i), pot: child.enabledPot, amount: 1n, beneficiaryKind: i % 2 }));
  return { protocolVersion: 3, programme, slot, nonce: 4n, upload: publicPackage(programme, slot, awards), fees: { ...lifecycleFees }, action,
    ...(action === "upload_awards" ? { batchStart: 0, batchSize: count } : action === "complete_funding" ? {} : {
      publication: { reviewPeriod: child.reviewPeriod, reviewStartedAt: 100n, officialPublishedAt: 100n + child.reviewPeriod, publicationEvidenceHash: h(40) } }) };
}
