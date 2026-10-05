import { readAllocationUploadV3, storeAllocationUploadV3, allocationDocumentHashV3, readAllocationApprovalV3, RewardLedgerStoreError,
  type AllocationUploadScopeV3, type AllocationUploadChangeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { allocationApprovalReasonsV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { canonicalRewardJson, commitPrivateRewardDocument, rewardUploadDigest, type RewardPublicAward } from "@raceson/rewards-chain";
import { rewardProgrammeChildV3 } from "@raceson/rewards-chain/programme-v3";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";

function check(value: unknown, code = "invalid_reward_allocation_upload"): asserts value { if (!value) throw new RewardLedgerStoreError(code); }
const same = (a: unknown, b: unknown) => canonicalRewardJson(a) === canonicalRewardJson(b);
type Export = Awaited<ReturnType<typeof readAllocationUploadV3>>;
type UploadDocument = {binding:Export["document"]["binding"];record:{chainId:number};recipients:Export["document"]["recipients"];
  calculation:{budgetWei:bigint;proposedWei:bigint;retainedWei:bigint}};

/** Full deterministic composition from a saved approval and its saved randomness.
 * No clock or wallet is invented. This package can upload rows but deliberately
 * has NO allocationDigest/stage calldata until genuine publication evidence is
 * attached by the V3 lifecycle. A digest is not an execution authorization. */
export function composeAllocationUploadV3(facts: Export) {
  check(allocationApprovalReasonsV3(facts.document).length === 0);
  return composeApprovedAllocationUploadV3(facts, 0);
}
/** Shared deterministic encoding only. Each versioned caller must validate its
 * own approved document/source before supplying these saved private facts. */
export function composeApprovedAllocationUploadV3<P extends 0|1>(
  facts:Pick<Export,"documentHash"|"snapshotSalt"|"recipients"> & {document:UploadDocument}, enabledPot:P) {
  const { document: d } = facts, b = d.binding;
  check(b && allocationDocumentHashV3(d) === facts.documentHash);
  check(d.recipients.length === facts.recipients.length);
  const mapped = new Map(facts.recipients.map(r => [JSON.stringify([r.beneficiaryKind, r.sourceBeneficiaryId]), r]));
  check(mapped.size === facts.recipients.length);
  const salts = new Set(facts.recipients.map(r => r.explanationSalt));
  check(salts.size === facts.recipients.length && !salts.has(facts.snapshotSalt));
  const awards: RewardPublicAward[] = d.recipients.map((recipient): RewardPublicAward => {
    const r = mapped.get(JSON.stringify([recipient.beneficiaryKind, recipient.beneficiaryId]));
    check(r && r.amountWei === recipient.amountWei);
    return { entitlementId: r.entitlementId, beneficiaryId: r.opaqueBeneficiaryId, pot: enabledPot,
      amount: recipient.amountWei, beneficiaryKind: recipient.beneficiaryKind === "athlete" ? 0 : 1,
      explanationHash: commitPrivateRewardDocument("explanation", { schema: "raceson-award-explanation-v3",
        documentHash: facts.documentHash, recipient }, r.explanationSalt) };
  }).sort((a, b) => a.entitlementId < b.entitlementId ? -1 : a.entitlementId > b.entitlementId ? 1 : 0);
  const upload = rewardUploadDigest(awards, enabledPot, d.calculation.budgetWei);
  check(upload.total === d.calculation.proposedWei && d.calculation.budgetWei - upload.total === d.calculation.retainedWei);
  return { schema: "raceson-award-upload-v3" as const, protocolVersion: 3 as const, chainId: d.record.chainId,
    programmeAddress: b.programmeAddress, campaignAddress: b.campaignAddress, deploymentTransactionHash: b.deploymentTransactionHash,
    programmeId: b.programmeId, campaignId: b.campaignId, programmeManifestHash: b.programmeManifestHash,
    enabledPot, reviewPeriod: String(b.reviewSeconds), budgetWei: d.calculation.budgetWei.toString(),
    allocatedWei: upload.total.toString(), unallocatedWei: d.calculation.retainedWei.toString(),
    snapshotDigest: commitPrivateRewardDocument("snapshot", { schema: "raceson-approved-allocation-v3", document: d }, facts.snapshotSalt),
    uploadDigest: upload.digest, entitlementCount: upload.count.toString(), awards: awards.map(r => ({ ...r, amount: r.amount.toString() })) };
}

/** Authenticated preparation only: no RPC broadcast, key, nonce reservation,
 * stage, activation or payout. HTTP gets a whitelist, never the private export. */
export async function allocationUploadV3(identity: RewardAccountIdentity, input: AllocationUploadScopeV3,
  change: AllocationUploadChangeV3 | undefined, rpc?: RewardLedgerRpc) {
  const actor = { ...identity }, scope = { ...input }, fixed = change && { ...change };
  let facts = await readAllocationUploadV3(actor, scope, rpc);
  const package_ = composeAllocationUploadV3(facts);
  if (facts.prepared) check(same(facts.prepared.package, package_));
  if (fixed && !facts.prepared) {
    check(facts.current, "reward_allocation_not_ready");
    check(fixed.contextHash === facts.contextHash && fixed.documentHash === facts.documentHash, "reward_planning_revision_changed");
    // Derive factory child again from the registered parent, not an arbitrary
    // stored browser-selected address. Future workers must do live verification.
    const state = await readAllocationApprovalV3(actor, scope, rpc);
    check(state.approval?.id === scope.approvalId && state.approval.current && state.provenance
      && state.contextHash === facts.contextHash && state.approval.documentHash === facts.documentHash, "reward_planning_revision_changed");
    const plan = programmeDeploymentPlanV3(state.context), child = rewardProgrammeChildV3(plan, scope.slot - 1);
    check(package_.programmeAddress === plan.context.verifyingContract.toLowerCase()
      && package_.campaignAddress === child.context.verifyingContract.toLowerCase() && package_.campaignId === child.campaignId
      && package_.programmeId === plan.programmeId && package_.programmeManifestHash === plan.programmeManifestHash
      && package_.reviewPeriod === child.reviewPeriod.toString() && package_.budgetWei === child.budgetWei.toString()
      && package_.deploymentTransactionHash === state.provenance.transactionHash);
  }
  if (fixed) facts = await storeAllocationUploadV3(actor, scope, { ...fixed, package: package_ }, rpc);
  const after = await readAllocationUploadV3(actor, scope, rpc);
  check(after.contextHash === facts.contextHash && after.current === facts.current
    && same(after.prepared, facts.prepared) && same(composeAllocationUploadV3(after), package_), "reward_planning_revision_changed");
  return { schema: "raceson-allocation-upload-view-v3" as const, chainId: scope.chainId, draftId: scope.draftId, slot: scope.slot,
    approvalId: scope.approvalId, contextHash: after.contextHash, documentHash: after.documentHash, current: after.current,
    campaignAddress: package_.campaignAddress, budgetWei: package_.budgetWei, allocatedWei: package_.allocatedWei,
    unallocatedWei: package_.unallocatedWei, entitlementCount: package_.entitlementCount,
    prepared: after.prepared ? { id: after.prepared.id, packageHash: after.prepared.packageHash, preparedAt: after.prepared.preparedAt } : null,
    stageReady: false as const, payableWei: "0" as const };
}
