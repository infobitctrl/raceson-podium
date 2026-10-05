import type { RequestSession } from "@raceson/domain";
import { adaptRewardSourceEvidence, calculateLeagueRewards, calculateRoundRewards, requireReward,
  reviewRewardRoundEvidence, selectRewardFinishes, type RewardAllocationResult } from "@raceson/domain/rewards";
import { decodeRewardSportingReview, readRewardCalculationContext, recordRewardSportingReview,
  reserveRewardAllocation, rewardDocumentUuid, type RewardCalculationContext, type RewardLedgerRpc,
  type RewardSportingReviewBody } from "@raceson/db/rewards";
import { loadRewardRecordApprovals } from "./record-approval-service.js";

function actor(session: RequestSession): string {
  // The HTTP boundary must call its existing checked requireSession first. This
  // service never accepts an actor, role, wallet or eligibility flag in its body.
  // SQL additionally requires the designated operator's CURRENT organization role;
  // platform support mode alone cannot impersonate that operator.
  return rewardDocumentUuid(session.account.userId);
}

export async function calculateRewardSportingContext(context: RewardCalculationContext, review: RewardSportingReviewBody, rpc?: RewardLedgerRpc) {
  const { programme, campaign, snapshot } = context;
  const configuration = { ...programme.configuration,
    rounds: programme.configuration.rounds.filter((round) => campaign.roundIds.includes(round.id)) };
  const evidence = adaptRewardSourceEvidence(snapshot, configuration);
  requireReward(evidence.rounds.every((round) => round.openCaseIds.length === 0), "reward_round_has_unresolved_adjudication");
  // Selection includes all eligible non-winners. No account/age/wallet/club-owner
  // readiness is loaded here and none may change the denominator or reservation.
  const selected = selectRewardFinishes(evidence.finishes, review.adjudications);
  let result: RewardAllocationResult;
  let recordEvidence: Awaited<ReturnType<typeof loadRewardRecordApprovals>> = [];
  if (campaign.pot === "league") {
    requireReward(configuration.rounds.length === 5 && campaign.scopeKey === "rounds-1-5", "invalid_league_round_scope");
    // League money rewards participation, not podium classification membership.
    // Explicit adjudications cover all five rounds; unrelated age/rank reviews
    // must not become a reason to exclude a finisher from metres/club finishes.
    requireReward(review.roundReviews.length === 0, "league_reward_review_has_round_awards");
    result = calculateLeagueRewards({ programmeId: programme.id, scopeId: campaign.scopeKey,
      roundIds: campaign.roundIds, budgetWei: campaign.budgetWei, finishes: evidence.finishes, adjudications: review.adjudications });
  } else {
    requireReward(configuration.rounds.length === 1 && review.roundReviews.length === 1
      && review.roundReviews[0].roundId === campaign.scopeKey, "reward_round_review_scope_mismatch");
    const round = review.roundReviews[0];
    const expectedRecords = configuration.rounds[0].races.flatMap((race) => ["M", "F"].map((gender) => `${race.id}:${gender}`)).sort();
    requireReward(JSON.stringify(round.records.map((record) => `${record.raceId}:${record.gender}`).sort()) === JSON.stringify(expectedRecords)
      && round.records.every((record) => record.id === `${record.raceId}:${record.gender}`), "invalid_record_divisions");
    // A client approvalId/time is never sufficient. Load the immutable approval,
    // independently re-derive its baseline and bind each supplied value exactly.
    // New writes also reject revoked/superseded/omitted approvals and changed prior
    // sources inside their transaction; historical preview/replay is not renewal.
    recordEvidence = await loadRewardRecordApprovals(context, round.records, rpc);
    const reviewed = reviewRewardRoundEvidence(evidence, campaign.scopeKey, {
      snapshotId: snapshot.snapshotId, sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
      approvalId: context.review?.id ?? "operator-review-preview", podiums: round.podiums,
      memberships: round.memberships, adjudications: review.adjudications,
    });
    result = calculateRoundRewards({ programmeId: programme.id, roundId: campaign.scopeKey,
      budgetWei: campaign.budgetWei, records: round.records, ...reviewed });
  }
  return { result, selectedSourceIds: selected.finishes.map((finish) => finish.sourceId),
    diagnostics: evidence.diagnostics, recordEvidence,
    sourceReviewEndsAt: [...evidence.rounds, ...recordEvidence].reduce((latest, item) =>
      item.sourceReviewEndsAt > latest ? item.sourceReviewEndsAt : latest, 0n) };
}

type ReviewInput = { campaignId: string; snapshotId: string; review: unknown };
async function prepareReview(session: RequestSession, input: ReviewInput, rpc?: RewardLedgerRpc) {
  const actorUserId = actor(session); const campaignId = rewardDocumentUuid(input.campaignId); const snapshotId = rewardDocumentUuid(input.snapshotId);
  // Decode into owned typed objects BEFORE awaiting any network call.
  const review = decodeRewardSportingReview(input.review);
  const context = await readRewardCalculationContext({ actorUserId, campaignId, snapshotId }, rpc);
  return { actorUserId, campaignId, snapshotId, review, calculated: await calculateRewardSportingContext(context, review, rpc) };
}

/** PRIVATE organizer preview, not a funded/active/claimable/paid projection.
 * An old snapshot can be inspected. Saving or reserving rechecks freshness in SQL.
 * Publication/staging clocks are revalidated later at chain activation. */
export async function previewRewardSportingReview(session: RequestSession, input: ReviewInput, rpc?: RewardLedgerRpc) {
  const { calculated } = await prepareReview(session, input, rpc);
  return calculated;
}

/** The organizer supplies sporting evidence decisions, never prize amounts.
 * Run the full computation before persisting a review. SQL atomically checks the
 * source/authority again, so a concurrent correction cannot be newly approved. */
export async function submitRewardSportingReview(session: RequestSession, input: ReviewInput & { idempotencyKey: string }, rpc?: RewardLedgerRpc) {
  const idempotencyKey = input.idempotencyKey;
  const prepared = await prepareReview(session, input, rpc);
  return recordRewardSportingReview({ actorUserId: prepared.actorUserId, campaignId: prepared.campaignId,
    snapshotId: prepared.snapshotId, review: prepared.review, idempotencyKey }, rpc);
}

/** Allocation input is ONLY a persisted review reference plus idempotency. The
 * browser cannot supply amounts, config, source selection or beneficiary bindings.
 * DB reservation remains a single atomic RPC; separate read/write calls are NOT
 * presented as one transaction. The write revalidates current source/latest review.
 * Exact retries recompute the same historical input, then return the old ledger. */
export async function reserveReviewedRewardAllocation(session: RequestSession, input: {
  campaignId: string; reviewId: string; idempotencyKey: string;
}, rpc?: RewardLedgerRpc) {
  const actorUserId = actor(session); const campaignId = rewardDocumentUuid(input.campaignId);
  const reviewId = rewardDocumentUuid(input.reviewId); const idempotencyKey = input.idempotencyKey;
  const context = await readRewardCalculationContext({ actorUserId, campaignId, reviewId }, rpc);
  requireReward(context.review, "reward_sporting_review_required");
  const { result, selectedSourceIds } = await calculateRewardSportingContext(context, context.review.body, rpc);
  const reserved = await reserveRewardAllocation({ actorUserId, reviewId, idempotencyKey, result, selectedSourceIds }, rpc);
  requireReward(reserved.campaignId === campaignId, "reward_allocation_campaign_mismatch");
  return reserved;
}
