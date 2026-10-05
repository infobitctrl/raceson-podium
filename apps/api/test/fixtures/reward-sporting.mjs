import { calculationFixture, rewardId as id } from "./reward-calculation.mjs";
import { getOrganizerSportingSource, previewOrganizerSportingReview } from "../../dist/features/rewards/organizer-sporting-service.js";
import { getOrganizerRewardPreparation } from "../../dist/features/rewards/organizer-preparation-service.js";

/** Synthetic fixture only: real application calculation, no real identity or DB. */
export async function sportingFixture(pot = "race") {
  const f = calculationFixture(pot, 1, 10000n * 10n ** 18n), selection = { programmeId: f.context.programme.id, campaignId: f.campaignId, chainId: /** @type {31337} */ (31337) },
    identity = { userId: f.actorId, sessionId: id(98600) };
  f.context.review = null;
  const names = [...new Map(f.source.rows.map(r => [r.canonicalAthleteId, { kind: "athlete", id: r.canonicalAthleteId, name: `Synthetic runner ${Number(r.canonicalAthleteId.slice(-3)) + 1}` }])).values(),
    { kind: "club", id: id(2000), name: "Synthetic club" }];
  const bundle = { ...selection, context: f.context, latestReviewId: null, latestRevision: 0, allocationId: null, names, recordApprovals: [] };
  const rpc = async name => {
    if (name === "service_read_reward_operator_sporting_context") return { data: structuredClone({ ...bundle, context: { ...bundle.context, review: null } }), error: null };
    if (name === "service_check_reward_operator_preparation") return { data: selection, error: null };
    if (name === "service_read_reward_operator_preparation") return { data: { ...selection, budgetWei: f.context.campaign.budgetWei, allocationId: null,
      latestReviewId: f.reviewId, context: f.context, names, recordApprovals: [] }, error: null };
    throw Error("unexpected synthetic RPC");
  };
  const view = await getOrganizerSportingSource(identity, selection, { snapshotId: null }, rpc);
  const capture = { ...selection, snapshotId: f.snapshotId, capturedAt: f.context.snapshot.capturedAt };
  const saved = { ...selection, snapshotId: f.snapshotId, reviewId: f.reviewId, revision: 1, reviewedAt: "2026-09-09T10:00:00Z" };
  return { f, selection, identity, view, capture, saved, bundle, rpc,
    async preview(request) { return previewOrganizerSportingReview(identity, selection, request, rpc); },
    async preparation(review) {
      f.context.review = { id: f.reviewId, revision: 1, reviewedAt: saved.reviewedAt, reviewedByUserId: f.actorId, body: review };
      return getOrganizerRewardPreparation(identity, selection, null, rpc);
    },
  };
}
