import {rewardResultDisplay} from "./result-review-display.js";
import {sponsorAllocationFactsV4, sponsorAllocationDocumentHashV4, decodeHistoricalSourceFactsV4, decodeLeaguePublicationFactsV3,
  copyRewardLedgerDocument as copy, RewardLedgerStoreError, type SponsorAllocationScopeV4, type RewardAccountIdentity, type RewardLedgerRpc} from "@raceson/db/rewards";
import {previewSponsorAllocation} from "@raceson/domain/rewards/sponsor-allocation";
import {finalAllocationSourceFromFactsV3} from "./final-allocation-v3-service.js";

export type SponsorAllocationDecisionV4 = {requestId: string; expectedApprovalId: string | null; contextHash: string; documentHash: string; decision: "approved" | "held"};
function check(v: unknown, code = "reward_planning_revision_changed"): asserts v {if (!v) throw new RewardLedgerStoreError(code);}
/** A private, deterministic document. The API accepts neither sporting facts nor
 * monetary amounts. Source authority comes from SQL, separately from sponsorship. */
export function sponsorAllocationDocumentV4(actor: RewardAccountIdentity, scope: SponsorAllocationScopeV4,
  facts: Awaited<ReturnType<typeof sponsorAllocationFactsV4>>) {
  const {launch, execution} = facts, draftId = launch.setup.configuration.context?.draftId;
  check(draftId, "reward_sponsor_source_not_ready");
  const historical = scope.slot >= 1 && scope.slot <= 4;
  const adapted = historical ? decodeHistoricalSourceFactsV4(facts.sourceFacts, scope.chainId, draftId)
    : finalAllocationSourceFromFactsV3(decodeLeaguePublicationFactsV3(facts.sourceFacts, actor,
      {chainId: scope.chainId, draftId, requestId: null}), scope.slot === 0 ? 6 : 5);
  const {source, workspace} = adapted;
  // Observation time is not a sporting fact. Stable evidence times make repeated
  // reads reproducible without weakening the SQL source/review freshness guard.
  source.capturedAt = new Date(Math.max(0, ...source.rounds.flatMap(r => r.evidence ? [Date.parse(r.evidence.publishedAt)] : []),
    ...source.standings.map(t => Date.parse(t.evidence.publishedAt)), ...(source.league ? [Date.parse(source.league.evidence.publishedAt)] : []))).toISOString();
  const binding = {draftId, catalogueHash: workspace.catalogueHash, sourceLeagueId: source.sourceLeagueId, sourceSeasonId: source.sourceSeasonId};
  const preview = previewSponsorAllocation(launch, execution.plan, binding, source), calculation = preview.pots.find(p => p.slot === scope.slot)!;
  return {schema: "raceson-sponsor-allocation-document-v4" as const, launch, plan: execution.plan, binding, source,
    slot: scope.slot, contextHash: facts.contextHash, calculation};
}

/** Exact award approval only. Staging, finalized funding, destination consent and
 * payment remain separate capabilities; this endpoint cannot sign or send. */
export async function sponsorAllocationReviewV4(identity: RewardAccountIdentity, input: SponsorAllocationScopeV4,
  change?: SponsorAllocationDecisionV4, rpc?: RewardLedgerRpc) {
  const actor = {...identity}, fixed = change && {...change}, scope = {...input, requestId: fixed?.requestId};
  const state = await sponsorAllocationFactsV4(actor, scope, undefined, rpc);
  const acknowledgement = (r: typeof state.approval) => r && {id: r.id, previousApprovalId: r.previousApprovalId,
    documentHash: r.documentHash, contextHash: r.contextHash, decision: r.decision, createdAt: r.createdAt, current: r.current};
  if (fixed && state.recorded) {
    const r = state.recorded;
    check(r.documentHash === fixed.documentHash && r.contextHash === fixed.contextHash && r.previousApprovalId === fixed.expectedApprovalId
      && r.decision === fixed.decision, "reward_sponsor_approval_conflict");
    return copy({schema: "raceson-sponsor-allocation-review-v4", setupId: scope.setupId, slot: scope.slot,
      approval: acknowledgement(state.approval), recorded: acknowledgement(r), historicalAcknowledgement: true,
      stageReady: false, payableWei: "0"});
  }
  const document = sponsorAllocationDocumentV4(actor, scope, state), documentHash = sponsorAllocationDocumentHashV4(document), c = document.calculation;
  const reasons = [...new Set(c.groups.flatMap(g => g.hold ? [g.hold] : [])), ...(c.budgetWei === 0n ? ["empty_pot"] : [])];
  if (state.approval?.current) check(state.approval.documentHash === documentHash, "invalid_sponsor_allocation");
  let final = state;
  if (fixed) {
    check(fixed.contextHash === state.contextHash && fixed.documentHash === documentHash);
    check(fixed.expectedApprovalId === (state.approval?.id ?? null), "reward_sponsor_approval_conflict");
    check(fixed.decision === "held" || !reasons.length, "reward_sponsor_source_not_ready");
    final = await sponsorAllocationFactsV4(actor, scope, {expectedApprovalId: fixed.expectedApprovalId, contextHash: state.contextHash,
      document, decision: fixed.decision}, rpc);
  }
  const historical = scope.slot >= 1 && scope.slot <= 4
    ? decodeHistoricalSourceFactsV4(state.sourceFacts, scope.chainId, document.binding.draftId) : null;
  const decision = historical?.decisions.find(d => d.slot === scope.slot);
  const sourceReview = historical ? {draftId: document.binding.draftId, contextHash: historical.contextHash,
    name: historical.workspace.catalogue.rounds.find(r => r.slot === scope.slot)?.name ?? `Round ${scope.slot}`,
    status: !decision ? "unreviewed" : !decision.current ? "stale" : decision.decision === "held" ? "held" : "confirmed"} : null;
  return copy({schema: "raceson-sponsor-allocation-review-v4", setupId: scope.setupId, slot: scope.slot,
    results: rewardResultDisplay(document, historical ? (state.sourceFacts as {snapshot:unknown}).snapshot :
      (state.sourceFacts as {policy?:{facts?:{historical?:{snapshot?:unknown}}}}).policy?.facts?.historical?.snapshot,
      Boolean(historical && (!decision || !decision.current) && reasons.includes("source_held"))),
    sourceReview, contextHash: state.contextHash, documentHash, sourceKind: document.source.kind, reasons, budgetWei: c.budgetWei, proposedWei: c.proposedWei, retainedWei: c.retainedWei,
    groups: c.groups.map(g => ({id: g.groupId, type: g.type, budgetWei: g.budgetWei, proposedWei: g.proposedWei, retainedWei: g.retainedWei,
      hold: g.hold, recipientCount: g.awards.length})),
    recipients: c.recipients.map((r, index) => ({position: index + 1, beneficiaryKind: r.beneficiaryKind, amountWei: r.amountWei})),
    recipientCounts: {athletes: c.recipients.filter(r => r.beneficiaryKind === "athlete").length, clubs: c.recipients.filter(r => r.beneficiaryKind === "club").length},
    approval: acknowledgement(final.approval), recorded: acknowledgement(final.recorded), historicalAcknowledgement: false,
    stageReady: false, payableWei: "0"});
}
