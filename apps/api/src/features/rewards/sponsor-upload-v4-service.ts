import {getContractAddress, getAddress, type Hex} from "viem";
import {sponsorUploadFactsV4, sponsorAllocationFactsV4, sponsorAllocationDocumentHashV4 as digest,
  RewardLedgerStoreError, type SponsorUploadScopeV4, type RewardAccountIdentity, type RewardLedgerRpc} from "@raceson/db/rewards";
import {canonicalRewardJson as canonical, commitPrivateRewardDocument, rewardUploadDigest, type RewardPublicAward} from "@raceson/rewards-chain";
import {observeSponsorProgrammePot, sponsorContractConfiguration, type SponsorChainReader} from "@raceson/rewards-chain/sponsor-v4";
import {sponsorAllocationDocumentV4} from "./sponsor-allocation-v4-service.js";
function check(v: unknown, code = "invalid_sponsor_upload"): asserts v {if (!v) throw new RewardLedgerStoreError(code);}
type Facts = Awaited<ReturnType<typeof sponsorUploadFactsV4>>;
export type SponsorUploadChangeV4 = {requestId: string; contextHash: string; documentHash: string};
/** Stable approved rows; deliberately no fabricated publication clock, allocation
 * digest or stage calldata. Private source/profile IDs and salts stay off-chain. */
export function composeSponsorUploadV4(facts: Facts, programmeAddress: string) {
  const d = facts.document, c = sponsorContractConfiguration(d.plan), e = facts.execution;
  check(e.deploymentHash && e.fundingHash && digest(d) === facts.documentHash);
  const parent = getAddress(programmeAddress).toLowerCase() as `0x${string}`;
  check(BigInt(parent) !== 0n);
  const nonce = 1n + BigInt(d.plan.caps.slice(0, d.slot).filter(v => BigInt(v) > 0n).length);
  const campaignAddress = getContractAddress({from: parent, nonce}).toLowerCase();
  const byRecipient = new Map(facts.recipients.map(r => [`${r.beneficiaryKind}:${r.beneficiaryId}`, r]));
  check(byRecipient.size === facts.recipients.length && byRecipient.size === d.calculation.recipients.length);
  const salts = new Set(facts.recipients.map(r => r.explanationSalt));
  check(salts.size === facts.recipients.length && !salts.has(facts.snapshotSalt));
  const awards: RewardPublicAward[] = d.calculation.recipients.map((r): RewardPublicAward => {
    const saved = byRecipient.get(`${r.beneficiaryKind}:${r.beneficiaryId}`);
    check(saved && saved.amountWei === r.amountWei);
    return {entitlementId: saved.entitlementId, beneficiaryId: saved.opaqueBeneficiaryId, pot: d.slot === 0 ? 1 : 0,
      amount: r.amountWei, beneficiaryKind: r.beneficiaryKind === "athlete" ? 0 : 1,
      explanationHash: commitPrivateRewardDocument("explanation", {schema: "raceson-sponsor-award-explanation-v4", documentHash: facts.documentHash, recipient: r}, saved.explanationSalt)};
  }).sort((a, b) => a.entitlementId < b.entitlementId ? -1 : a.entitlementId > b.entitlementId ? 1 : 0);
  const upload = rewardUploadDigest(awards, d.slot === 0 ? 1 : 0, d.calculation.budgetWei);
  check(upload.total === d.calculation.proposedWei && d.calculation.budgetWei - upload.total === d.calculation.retainedWei);
  return {schema: "raceson-sponsor-upload-v4" as const, protocolVersion: 4, chainId: d.plan.chainId, slot: d.slot,
    approvalId: facts.approvalId, documentHash: facts.documentHash, programmeAddress: parent, campaignAddress,
    deploymentHash: e.deploymentHash, fundingHash: e.fundingHash, programmeId: c.programmeId, campaignId: c.campaignIds[d.slot]!, programmeManifestHash: c.manifestHash,
    reviewPeriod: c.reviewPeriods[d.slot]!.toString(), claimLifetime: c.claimLifetime.toString(),
    unallocatedTreasury: c.unallocatedTreasury, expiredTreasury: c.expiredTreasury, cancellationTreasury: c.funder,
    budgetWei: d.calculation.budgetWei.toString(), allocatedWei: upload.total.toString(), unallocatedWei: d.calculation.retainedWei.toString(),
    snapshotDigest: commitPrivateRewardDocument("snapshot", {schema: "raceson-approved-sponsor-allocation-v4", approvalId: facts.approvalId, document: d}, facts.snapshotSalt),
    uploadDigest: upload.digest, entitlementCount: upload.count.toString(), awards: awards.map(r => ({...r, amount: r.amount.toString()}))};
}
function storedPackage(f: Facts) {
  if (!f.prepared) return null;
  const p = f.prepared.package;
  check(p && typeof p === "object" && !Array.isArray(p) && typeof p.programmeAddress === "string");
  const rebuilt = composeSponsorUploadV4(f, p.programmeAddress);
  check(canonical(p) === canonical(rebuilt)); return rebuilt;
}
export async function sponsorUploadV4(identity: RewardAccountIdentity, input: SponsorUploadScopeV4, change: SponsorUploadChangeV4 | undefined,
  dependencies: {rpc?: RewardLedgerRpc; reader?: SponsorChainReader} = {}) {
  const actor = {...identity}, scope = {...input}, fixed = change && {...change}, {rpc, reader} = dependencies;
  let facts = await sponsorUploadFactsV4(actor, scope, undefined, rpc), package_ = storedPackage(facts);
  if (fixed) {
    check(fixed.contextHash === facts.contextHash && fixed.documentHash === facts.documentHash, "reward_planning_revision_changed");
    if (facts.prepared) {
      check(facts.prepared.id === fixed.requestId && facts.prepared.actorUserId === actor.userId, "reward_sponsor_upload_conflict");
    } else {
      check(facts.current, "reward_sponsor_source_not_ready");
      const state = await sponsorAllocationFactsV4(actor, scope, undefined, rpc);
      check(state.approval?.id === scope.approvalId && state.approval.current && state.approval.decision === "approved"
        && digest(sponsorAllocationDocumentV4(actor, scope, state)) === facts.documentHash, "reward_planning_revision_changed");
      const e = facts.execution;
      check(reader && e.deploymentHash && e.fundingHash, "reward_sponsor_funding_not_ready");
      const observation = await observeSponsorProgrammePot(reader, e.plan, e.deploymentHash as Hex, e.fundingHash as Hex, scope.slot);
      const pot = observation.pots.find(p => p.slot === scope.slot);
      check(observation.funded && !observation.cancelled && pot && pot.state === 1 && !pot.paused && pot.allocatedWei === "0"
        && pot.paidWei === "0" && pot.returnedWei === "0" && pot.entitlementCount === "0" && pot.remainingWei === e.plan.caps[scope.slot], "reward_sponsor_funding_not_ready");
      package_ = composeSponsorUploadV4(facts, observation.address);
      check(pot.address === package_.campaignAddress && pot.amountWei === package_.budgetWei);
      const after = await sponsorUploadFactsV4(actor, scope, undefined, rpc);
      check(after.current && canonical(after.execution) === canonical(e) && after.documentHash === facts.documentHash, "reward_planning_revision_changed");
      facts = await sponsorUploadFactsV4(actor, scope, {...fixed, package: package_, funding: observation}, rpc);
      package_ = storedPackage(facts);
    }
  }
  // Recheck session/source authority after all IO, even for historical retries.
  const after = await sponsorUploadFactsV4(actor, scope, undefined, rpc);
  check(canonical(after.prepared) === canonical(facts.prepared) && after.current === facts.current, "reward_planning_revision_changed");
  return {schema: "raceson-sponsor-upload-view-v4", approvalId: scope.approvalId, slot: scope.slot, contextHash: after.contextHash,
    documentHash: after.documentHash, current: after.current, sourceKind: after.document.source.kind,
    budgetWei: after.document.calculation.budgetWei.toString(), allocatedWei: after.document.calculation.proposedWei.toString(),
    unallocatedWei: after.document.calculation.retainedWei.toString(), recipientCount: after.recipients.length,
    campaignAddress: package_?.campaignAddress ?? null,
    prepared: after.prepared ? {id: after.prepared.id, packageHash: after.prepared.packageHash, preparedAt: after.prepared.preparedAt} : null,
    executionStatus: "not_observed", stageReady: false, payableWei: "0"};
}
