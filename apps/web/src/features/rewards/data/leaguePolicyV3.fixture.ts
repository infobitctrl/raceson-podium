import { createRewardAllocationRehearsalV3 } from "@raceson/domain/rewards/allocation-rehearsal-v3";
import { proposeLeagueStandingsV3, type LeagueScoringPolicyV3 } from "@raceson/domain/rewards/league-standings-v3";
import type { LeaguePolicyViewV3 } from "@raceson/domain/rewards/league-policy-view-v3";
import { nativeContinuityUiFixture } from "./nativeContinuityV3.fixture";

/** Browser/unit fixture only: never imported by the application or persisted. */
export function leaguePolicyUiFixture(scenario: "four_rounds" | "five_rounds" | "distance_hold" = "five_rounds") {
  const { record, id } = nativeContinuityUiFixture(), f = createRewardAllocationRehearsalV3(scenario);
  const policy: LeagueScoringPolicyV3 = { schema: "raceson-league-scoring-policy-v3", categories: f.policy.pointsTables.map(c => ({ ...c,
    participationPoints: 0, bestN: 4, minimumRounds: 2, tieBreak: "best_finish" })), club: { categoryId: f.source.categories[7].id, membersPerRound: 3 } };
  const proposal = proposeLeagueStandingsV3(f.source, policy), review = { id: id(90), previousReviewId: null, contextHash: "a".repeat(64),
    policy: proposal.policy, decision: "selected" as const, reviewedAt: "2026-09-10T05:00:00.000Z" };
  const names = ["Short Female U16", "Short Male U16", "Short Female", "Short Male", "Short Senior 65+", "Long Female", "Long Male", "Combined clubs"];
  const data: LeaguePolicyViewV3 = { schema: "raceson-league-policy-workspace-v3", draftId: record.draftId, organizationId: record.organizationId,
    chainId: record.chainId, revision: record.revision, contextHash: review.contextHash, review, recordedReview: null, reviewState: "selected",
    categories: f.source.categories.map((c, i) => ({ ...c, name: names[i] })),
    labels: { athletes: proposal.athleteTables.flatMap(t => t.rows.map(r => ({ id: r.beneficiaryId, name: `Synthetic athlete ${Number(r.beneficiaryId.slice(-12))}` }))),
      clubs: (proposal.clubTables.find(t => t.slot === null)?.rows ?? []).map(r => ({ id: r.beneficiaryId, name: `Synthetic club ${Number(r.beneficiaryId.slice(-12))}` })) },
    proposalHash: "b".repeat(64), proposal, finalPublished: false, allocationApproved: false, payableWei: "0" };
  const missing: LeaguePolicyViewV3 = { ...data, review: null, reviewState: "missing", labels: { athletes: [], clubs: [] }, proposalHash: null, proposal: null };
  return { record, id, policy, data, missing };
}
