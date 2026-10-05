import { readProgrammeRegistryV3, leaguePublicationFactsV3, allocationDocumentHashV3, copyRewardLedgerDocument as copy,
  RewardLedgerStoreError, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { buildFinalAllocationDocumentV3, finalAllocationReasonsV3, type FinalAllocationSourceReviewV3 } from "@raceson/domain/rewards/final-allocation-document-v3";
import type { AllocationContractBindingV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { programmeApprovalRequestIdV3 as uuid } from "@raceson/domain/rewards/programme-approval-v3";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { rewardProgrammeChildV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { previewNativeFinaleContinuityV3 } from "./native-finale-continuity-service.js";
import { leaguePolicyContextV3 } from "./league-policy-v3-service.js";
import { publishedLeagueSourceFromFactsV3 } from "./league-publication-v3-service.js";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";
import { readRegisteredProgrammeFundingV3 } from "./programme-registry-v3-service.js";

export type FinalAllocationScopeV3 = { chainId: 31337 | 10143; draftId: string; slot: 5 | 6 };
function check(v: unknown, code = "reward_planning_revision_changed"): asserts v { if (!v) throw new RewardLedgerStoreError(code); }
const same = (a: unknown, b: unknown) => canonicalRewardJson(a) === canonicalRewardJson(b);

/** Private source adapter. Saved decisions and current Auth are loaded from
 * the isolated DB, not accepted from a request. A final league row must still
 * be the latest unheld publication of these exact five sources. */
export async function readFinalAllocationSourceV3(identity: RewardAccountIdentity, input: FinalAllocationScopeV3, rpc?: RewardLedgerRpc) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) };
  const scope = { chainId: input.chainId, draftId: uuid(input.draftId), slot: input.slot };
  check([31337, 10143].includes(scope.chainId) && [5, 6].includes(scope.slot), "invalid_reward_final_allocation");
  return finalAllocationSourceFromFactsV3(await leaguePublicationFactsV3(actor, scope, undefined, rpc), scope.slot);
}
export function finalAllocationSourceFromFactsV3(facts:Awaited<ReturnType<typeof leaguePublicationFactsV3>>,slot:5|6){
  check(slot===5||slot===6,"invalid_reward_final_allocation");
  if (slot === 6) {
    const p = publishedLeagueSourceFromFactsV3(facts), f = p.facts.policy.facts;
    const sourceReview: FinalAllocationSourceReviewV3 = { kind: "published_league", guardHash: p.facts.guardHash,
      publicationId: p.publication.id, publicationDocumentHash: p.publication.documentHash,
      evidenceHash: p.publication.evidenceHash, publishedAt: p.publication.publishedAt };
    return { record: f.record, workspace: f.workspace, source: p.source, sourceReview };
  }
  const policy = facts.policy, f = policy.facts;
  check(policy.review?.decision === "selected" && policy.review.contextHash === allocationDocumentHashV3(leaguePolicyContextV3(f)),
    "reward_final_allocation_source_not_ready");
  const r = f.review;
  const native = previewNativeFinaleContinuityV3({ ...f, review: r ? {
    id: r.id, contextHash: r.contextHash, selection: r.selection, decision: r.decision, reviewedAt: r.reviewedAt } : null });
  check(r && native.reviewState === "confirmed_selection" && native.commitment, "reward_final_allocation_source_not_ready");
  const sourceReview: FinalAllocationSourceReviewV3 = { kind: "native_finale",
    guardHash: facts.guardHash,
    continuityReviewId: r.id, continuityContextHash: native.contextHash, continuityCommitment: native.commitment,
    reviewedAt: r.reviewedAt, policyReview: policy.review };
  return { record: f.record, workspace: f.workspace, source: native.source, sourceReview };
}

/** Prepares the exact document for the upcoming approval/upload transaction.
 * This function has no write/sign/send capability. In particular, reading a
 * positive prize calculation never creates consent or an allocation approval. */
export async function prepareFinalAllocationV3(identity: RewardAccountIdentity, input: FinalAllocationScopeV3,
  dependencies: { rpc?: RewardLedgerRpc; reader?: RewardProgrammeReaderV3 } = {}) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, scope = { ...input }, { rpc, reader } = dependencies;
  const source = await readFinalAllocationSourceV3(actor, scope, rpc);
  const state = await readProgrammeRegistryV3(actor, scope, rpc), view = state.context.approvalView;
  check(same(source.record, view.record) && same(source.workspace.mapping, view.workspace.mapping)
    && source.workspace.revision === view.workspace.revision);
  let binding: AllocationContractBindingV3 | null = null;
  if (state.registry && state.context.intent?.current) {
    const plan = programmeDeploymentPlanV3(state.context), child = rewardProgrammeChildV3(plan, scope.slot - 1), p = state.registry.provenance;
    check(p.contractAddress === plan.context.verifyingContract.toLowerCase() && p.programmeId === plan.programmeId
      && p.programmeManifestHash === plan.programmeManifestHash, "reward_programme_binding_mismatch");
    binding = { intentId: state.context.intent.id, fundingApprovalId: state.context.intent.approvalId,
      programmeAddress: p.contractAddress, campaignAddress: child.context.verifyingContract.toLowerCase(), deploymentTransactionHash: p.transactionHash,
      programmeId: plan.programmeId, campaignId: child.campaignId, programmeManifestHash: plan.programmeManifestHash,
      reviewSeconds: Number(child.reviewPeriod), fundingContextHash: state.context.intent.contextHash };
  }
  const document = buildFinalAllocationDocumentV3(source.record, source.workspace, source.source, source.sourceReview, binding);
  const documentHash = allocationDocumentHashV3(document), reasons: string[] = finalAllocationReasonsV3(document);
  let funding = null;
  if (binding) {
    const view = await readRegisteredProgrammeFundingV3(actor, source.record, { reader, rpc });
    const pot = view.observation?.pots[scope.slot - 1];
    check(pot?.address.toLowerCase() === binding.campaignAddress, "reward_programme_binding_mismatch");
    if (!pot.routed || pot.accountedFundingWei !== document.calculation.budgetWei.toString() || pot.paused || pot.state > 1
      || pot.allocatedWei !== "0" || pot.paidWei !== "0" || pot.treasuryReturnedWei !== "0") reasons.push("funding_not_available");
    funding = { ...pot, address: pot.address.toLowerCase(), blockNumber: view.observation!.blockNumber,
      blockHash: view.observation!.blockHash, blockTimestamp: view.observation!.blockTimestamp };
  }
  // Detect source/policy/league hold, membership/session or registry changes
  // across external funding reads. A later SQL write will still need its own CAS.
  const registryAfter = await readProgrammeRegistryV3(actor, scope, rpc);
  check(same(registryAfter, state));
  const after = await readFinalAllocationSourceV3(actor, scope, rpc);
  check(allocationDocumentHashV3(buildFinalAllocationDocumentV3(after.record, after.workspace, after.source, after.sourceReview, binding)) === documentHash);
  return { document, documentHash, reasons, funding };
}

export async function finalAllocationViewV3(identity: RewardAccountIdentity, scope: FinalAllocationScopeV3,
  dependencies: Parameters<typeof prepareFinalAllocationV3>[2] = {}) {
  const p = await prepareFinalAllocationV3(identity, scope, dependencies), d = p.document, r = d.sourceReview;
  return copy({ schema: "raceson-final-allocation-view-v3", chainId: d.record.chainId, draftId: d.record.draftId, slot: d.slot,
    enabledPot: d.enabledPot, documentHash: p.documentHash, reasons: p.reasons, calculation: d.calculation,
    recipientCounts: { athletes: d.recipients.filter(r => r.beneficiaryKind === "athlete").length,
      clubs: d.recipients.filter(r => r.beneficiaryKind === "club").length },
    sourceDecision: r.kind === "native_finale" ? { kind: r.kind, continuityReviewId: r.continuityReviewId,
      policyReviewId: r.policyReview.id, reviewedAt: r.reviewedAt } : { kind: r.kind, publicationId: r.publicationId, publishedAt: r.publishedAt },
    campaignAddress: d.binding?.campaignAddress ?? null, funding: p.funding,
    allocationApproved: false, stageReady: false, payableWei: "0" });
}
