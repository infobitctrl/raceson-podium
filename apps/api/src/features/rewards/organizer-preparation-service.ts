import { createHash } from "node:crypto";
import { aggregateRewardEntitlements, decodeRewardPreparation, decodeRewardReservation, rewardPreviewCursor,
  rewardPreviewFamilies, requireReward, type RewardPreparationSelection } from "@raceson/domain/rewards";
import { readRewardOperatorPreparation, checkRewardPreparationAccess, reserveOperatorRewardAllocation,
  rewardAllocationRequest, copyRewardLedgerDocument, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { calculateRewardSportingContext } from "./calculation-service.js";

function fixed(identity: RewardAccountIdentity, selection: RewardPreparationSelection) {
  requireReward(selection.chainId === 31337 || selection.chainId === 10143, "invalid_reward_preparation_request");
  return { identity: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) },
    scope: { programmeId: uuid(selection.programmeId), campaignId: uuid(selection.campaignId), chainId: selection.chainId } };
}
async function calculate(bundle: Awaited<ReturnType<typeof readRewardOperatorPreparation>>, scope: RewardPreparationSelection) {
  const context = bundle.context; requireReward(context?.review, "reward_sporting_review_required");
  // The actual SQL bundle captured these private packets. This restricted local
  // transport lets the existing calculator re-derive every record approval.
  const approvals: RewardLedgerRpc = async (name, args) => {
    requireReward(name === "service_read_reward_record_approval" && args.p_campaign_id === scope.campaignId
      && args.p_actor_user_id === context.programme.operatorUserId && Object.keys(args).length === 3, "reward_record_approval_mismatch");
    const raw = bundle.recordApprovals.find(a => a.approvalId === args.p_approval_id);
    requireReward(raw, "reward_record_approval_required"); return { data: raw, error: null };
  };
  const calculated = await calculateRewardSportingContext(context, context.review.body, approvals);
  const allocation = rewardAllocationRequest(calculated);
  // Private UI confirmation only, not an on-chain root or public identity hash.
  // Names/page cursors are deliberately excluded; exact sporting payload is not.
  const previewDigest = createHash("sha256").update(JSON.stringify(copyRewardLedgerDocument({ schemaVersion: 1,
    scope, reviewId: context.review.id, snapshotId: context.snapshot.snapshotId, review: context.review.body, allocation }))).digest("hex");
  return { ...calculated, previewDigest, context };
}

/** Current operator's saved-review preview. All totals/awards are computed here;
 * a preview is historical calculation, not a freshness or payment approval. */
export async function getOrganizerRewardPreparation(identity: RewardAccountIdentity, selection: RewardPreparationSelection,
  afterId: string | null = null, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), after = afterId === null ? null : rewardPreviewCursor(afterId);
  const bundle = await readRewardOperatorPreparation(f.identity, f.scope, null, rpc);
  const base = { ...f.scope, budgetWei: bundle.budgetWei, allocationId: bundle.allocationId };
  if (bundle.allocationId || !bundle.context) {
    requireReward(after === null, "reward_preparation_changed");
    return decodeRewardPreparation({ ...base, stage: bundle.allocationId ? "reserved" : "awaiting_review", preview: null }, f.scope);
  }
  const c = await calculate(bundle, f.scope), result = c.result, awards = aggregateRewardEntitlements(result);
  const labels = new Map(bundle.names.map(n => [`${n.kind}:${n.id}`, n.name]));
  const rows = awards.map(a => ({ key: `${a.beneficiaryKind}:${a.beneficiaryId}`, kind: a.beneficiaryKind, id: a.beneficiaryId,
    name: labels.get(`${a.beneficiaryKind}:${a.beneficiaryId}`) ?? null, amountWei: a.amountWei.toString(),
    breakdown: [...new Set(a.breakdown.map(b => b.family))].sort().map(family => ({ family,
      amountWei: a.breakdown.filter(b => b.family === family).reduce((sum, b) => sum + b.amountWei, 0n).toString() })) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const page = rows.filter(a => after === null || a.key > after).slice(0, 26);
  const families = rewardPreviewFamilies(result.pot, result.budgetWei).map(f => {
    const allocated = result.awards.filter(a => a.family === f.key).reduce((sum, a) => sum + a.amountWei, 0n);
    return { family: f.key, budgetWei: f.amount.toString(), allocatedWei: allocated.toString(), unallocatedWei: (f.amount - allocated).toString() };
  });
  const response = decodeRewardPreparation({ ...base, stage: "preview", preview: {
    reviewId: c.context.review!.id, revision: c.context.review!.revision, snapshotId: c.context.snapshot.snapshotId,
    reviewedAt: c.context.review!.reviewedAt, capturedAt: c.context.snapshot.capturedAt, pot: result.pot, previewDigest: c.previewDigest,
    allocatedWei: (result.budgetWei - result.unallocatedWei).toString(), unallocatedWei: result.unallocatedWei.toString(),
    selectedFinishCount: c.selectedSourceIds.length, excludedFinishCount: result.excludedSourceIds.length, awardCount: rows.length, families,
    items: page.slice(0, 25), nextCursor: page.length > 25 ? page[24].key : null,
  } }, f.scope, after);
  // No private response after session/authority disappears during calculation.
  await checkRewardPreparationAccess(f.identity, f.scope, rpc);
  return response;
}

export async function reserveOrganizerRewardPreparation(identity: RewardAccountIdentity, selection: RewardPreparationSelection,
  input: { reviewId: string; previewDigest: string; idempotencyKey: string; confirmAllocation: true }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), reviewId = uuid(input.reviewId), previewDigest = input.previewDigest, idempotencyKey = input.idempotencyKey;
  requireReward(input.confirmAllocation === true && typeof previewDigest === "string" && /^[0-9a-f]{64}$/.test(previewDigest)
    && typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_preparation_request");
  const bundle = await readRewardOperatorPreparation(f.identity, f.scope, reviewId, rpc);
  const c = await calculate(bundle, f.scope);
  requireReward(c.previewDigest === previewDigest, "reward_preparation_changed");
  const reserved = await reserveOperatorRewardAllocation(f.identity, f.scope, { reviewId, idempotencyKey,
    result: c.result, selectedSourceIds: c.selectedSourceIds }, rpc);
  return decodeRewardReservation({ ...reserved, ...f.scope }, { ...f.scope, reviewId });
}
