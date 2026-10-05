import { allocationDocumentHashV3, readAllocationApprovalV3, storeAllocationApprovalV3, rewardHistoricalSourceV3,
  RewardLedgerStoreError, type AllocationApprovalScopeV3, type AllocationApprovalChangeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { buildAllocationDocumentV3, allocationApprovalReasonsV3, type AllocationContractBindingV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { rewardProgrammeChildV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";
import { readRegisteredProgrammeFundingV3 } from "./programme-registry-v3-service.js";

const same = (a: unknown, b: unknown) => canonicalRewardJson(a) === canonicalRewardJson(b);
function check(v: unknown, code = "reward_planning_revision_changed"): asserts v { if (!v) throw new RewardLedgerStoreError(code); }
/** No arbitrary address/amount/source/time enters via HTTP. Exact retries recover
 * history without signing, live funding IO or another set of recipient IDs.
 * A stored prize decision is NOT a final-publication timestamp or stage lease.
 */
export async function allocationApprovalV3(identity: RewardAccountIdentity, input: AllocationApprovalScopeV3,
  change: AllocationApprovalChangeV3 | undefined, dependencies: { reader?: RewardProgrammeReaderV3; rpc?: RewardLedgerRpc }) {
  const actor = { ...identity }, scope = { ...input, requestId: change?.requestId }, fixed = change && { ...change }, { reader, rpc } = dependencies;
  const state = await readAllocationApprovalV3(actor, scope, rpc);
  const historic = await rewardHistoricalSourceV3(actor, scope.chainId, scope.draftId, undefined, rpc);
  check(historic.contextHash === state.sourceContextHash && same(historic.decisions.find(d => d.slot === scope.slot) ?? null, state.decision)
    && same(historic.record, state.context.approvalView.record));
  let binding: AllocationContractBindingV3 | null = null;
  if (state.provenance && state.context.intent?.current) {
    const plan = programmeDeploymentPlanV3(state.context), child = rewardProgrammeChildV3(plan, scope.slot - 1), p = state.provenance;
    check(p.contractAddress === plan.context.verifyingContract.toLowerCase() && p.programmeId === plan.programmeId && p.programmeManifestHash === plan.programmeManifestHash);
    binding = { intentId: state.context.intent.id, fundingApprovalId: state.context.intent.approvalId,
      programmeAddress: p.contractAddress, campaignAddress: child.context.verifyingContract.toLowerCase(), deploymentTransactionHash: p.transactionHash,
      programmeId: plan.programmeId, campaignId: child.campaignId, programmeManifestHash: plan.programmeManifestHash,
      reviewSeconds: Number(child.reviewPeriod), fundingContextHash: state.context.intent.contextHash };
  }
  const document = buildAllocationDocumentV3(historic.record, historic.workspace, historic.sourceHash, historic.contextHash, scope.slot,
    historic.source, state.decision, binding), documentHash = allocationDocumentHashV3(document);
  if (state.approval?.current) check(state.approval.documentHash === documentHash, "invalid_reward_allocation_approval");
  const reasons: string[] = allocationApprovalReasonsV3(document);
  const response = (approval = state.approval, recorded = state.recorded) => ({ schema: "raceson-allocation-approval-v3" as const,
    contextHash: state.contextHash, documentHash, document, reasons, approval, recorded,
    stageReady: false as const, payableWei: "0" as const });
  if (fixed && state.recorded) {
    check(state.recorded.contextHash === fixed.contextHash && state.recorded.documentHash === fixed.documentHash
      && state.recorded.previousApprovalId === fixed.expectedApprovalId, "reward_allocation_approval_conflict");
    const after = await readAllocationApprovalV3(actor, scope, rpc); check(after.contextHash === state.contextHash && same(after.recorded, state.recorded));
    reasons.push("historical_acknowledgement"); return response(after.approval, after.recorded);
  }
  if (fixed) check(state.contextHash === fixed.contextHash && documentHash === fixed.documentHash
    && (state.approval?.id ?? null) === fixed.expectedApprovalId);
  let funding = null;
  if (binding) {
    const view = await readRegisteredProgrammeFundingV3(actor, historic.record, { reader, rpc });
    const p = view.observation?.pots[scope.slot - 1];
    check(p?.address.toLowerCase() === binding.campaignAddress, "invalid_reward_allocation_approval");
    if (!p.routed || p.accountedFundingWei !== document.calculation.budgetWei.toString() || p.paused
      || p.state > 1 || p.allocatedWei !== "0" || p.paidWei !== "0" || p.treasuryReturnedWei !== "0") reasons.push("funding_not_available");
    funding = { ...p, address: p.address.toLowerCase(), blockNumber: view.observation!.blockNumber,
      blockHash: view.observation!.blockHash, blockTimestamp: view.observation!.blockTimestamp };
  }
  const after = await readAllocationApprovalV3(actor, scope, rpc);
  check(after.contextHash === state.contextHash && same(after.approval, state.approval));
  if (!fixed) return response();
  check(reasons.length === 0 && funding, "reward_allocation_not_ready");
  const saved = await storeAllocationApprovalV3(actor, scope, { expectedApprovalId: fixed.expectedApprovalId,
    contextHash: fixed.contextHash, document, funding }, rpc);
  check(saved.recorded?.id === fixed.requestId && saved.recorded.documentHash === documentHash, "invalid_reward_allocation_approval");
  return response(saved.approval, saved.recorded);
}
