import { createHash } from "node:crypto";
import { adaptRewardSourceEvidence, aggregateRewardEntitlements, requireReward, rewardPreviewFamilies, decodeRewardSportingSource, decodeRewardSportingRecord,
  type RewardPreparationSelection } from "@raceson/domain/rewards";
import { captureRewardOperatorSource, readRewardOperatorSportingContext, saveRewardOperatorSportingReview, checkRewardPreparationAccess,
  decodeRewardSportingReview, decodeRewardRecordApproval, copyRewardLedgerDocument, rewardAllocationRequest, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { calculateRewardSportingContext } from "./calculation-service.js";
import { verifyStoredRewardRecordApproval } from "./record-approval-service.js";

function fixed(identity: RewardAccountIdentity, selection: RewardPreparationSelection) {
  requireReward(selection.chainId === 10143 || selection.chainId === 31337, "invalid_reward_sporting_request");
  return { identity: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) },
    scope: { programmeId: uuid(selection.programmeId), campaignId: uuid(selection.campaignId), chainId: selection.chainId } };
}
function revision(v: unknown) { requireReward(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483645, "invalid_reward_sporting_request"); return v; }
function key(v: unknown) { requireReward(typeof v === "string" && v.length >= 8 && v.length <= 128, "invalid_reward_sporting_request"); return v; }
function label(v: unknown) { return typeof v === "string" && v.trim() ? [...v.trim()].slice(0, 256).join("") : null; }
function publishedRank(v: unknown) { requireReward(v === null || (typeof v === "number" && Number.isSafeInteger(v) && v > 0), "invalid_reward_sporting_document"); return v as number | null; }

/** Inspect frozen source facts; no raw source JSON, DOB, account or wallet data.
 * Cursor reads pin a snapshot rather than paging a changing latest capture. */
export async function getOrganizerSportingSource(identity: RewardAccountIdentity, selection: RewardPreparationSelection,
  reference: { snapshotId: string | null; afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), snapshotId = reference.snapshotId === null ? null : uuid(reference.snapshotId),
    afterId = reference.afterId == null ? null : uuid(reference.afterId);
  requireReward(afterId === null || snapshotId !== null, "invalid_reward_sporting_request");
  const bundle = await readRewardOperatorSportingContext(f.identity, f.scope, { snapshotId }, rpc), context = bundle.context;
  const base = { ...f.scope, latestReviewId: bundle.latestReviewId, latestRevision: bundle.latestRevision, allocationId: bundle.allocationId };
  if (!context) { await checkRewardPreparationAccess(f.identity, f.scope, rpc); return { ...base, source: null }; }
  const configuration = { ...context.programme.configuration, rounds: context.programme.configuration.rounds.filter(r => context.campaign.roundIds.includes(r.id)) };
  const evidence = adaptRewardSourceEvidence(context.snapshot, configuration);
  const names = new Map(bundle.names.map(n => [`${n.kind}:${n.id}`, n.name]));
  const source = context.snapshot.source as { rows: Record<string, unknown>[]; classifications: Record<string, unknown>[] };
  const originalRows = new Map(source.rows.map(r => [r.id, r])), classNames = new Map(source.classifications.map(c => [c.id, label(c.name)]));
  const uncertain = new Map(evidence.uncertainMemberships.map(m => [m.sourceId, m.classificationIds]));
  const duplicateCounts = new Map<string, number>();
  for (const row of evidence.finishes) if (row.participationStatus === "finished") {
    const group = `${row.roundId}:${row.athleteId}`; duplicateCounts.set(group, (duplicateCounts.get(group) ?? 0) + 1);
  }
  const rows = evidence.finishes.filter(r => afterId === null || r.sourceId > afterId).slice(0, 26);
  const response = { ...base, source: {
    snapshotId: context.snapshot.snapshotId, capturedAt: context.snapshot.capturedAt, pot: context.campaign.pot,
    budgetWei: context.campaign.budgetWei.toString(), resultCount: evidence.finishes.length,
    finishedCount: evidence.finishes.filter(r => r.participationStatus === "finished").length,
    uncertainMembershipCount: evidence.uncertainMemberships.length,
    duplicateGroupCount: [...duplicateCounts.values()].filter(n => n > 1).length,
    classifications: configuration.classifications.map(c => ({ id: c.id, name: classNames.get(c.id) ?? null, competitionId: c.competitionId,
      gender: c.gender, minimumAgeHundredths: c.minimumAgeHundredths?.toString() ?? null, maximumAgeHundredths: c.maximumAgeHundredths?.toString() ?? null })),
    rounds: evidence.rounds.map(r => ({ id: r.id, number: configuration.rounds.find(c => c.id === r.id)!.number,
      sourceReviewEndsAtSeconds: r.sourceReviewEndsAt.toString(), openCaseIds: [...r.openCaseIds],
      races: configuration.rounds.find(c => c.id === r.id)!.races.map(race => ({ id: race.id, competitionId: race.competitionId, distanceMetres: race.distanceMetres.toString() })) })),
    items: rows.slice(0, 25).map(r => {
      const original = originalRows.get(r.sourceId)!;
      return { sourceId: r.sourceId, roundId: r.roundId, raceId: r.raceId, publicationId: r.publicationId,
        athleteId: r.athleteId, athleteName: names.get(`athlete:${r.athleteId}`) ?? null,
        representedClubId: r.representedClubId, clubName: names.get(`club:${r.representedClubId}`) ?? null,
        finishTimeMs: r.finishTimeMs?.toString() ?? null, distanceMetres: r.distanceMetres.toString(),
        participationStatus: r.participationStatus, resultStatus: r.resultStatus,
        classificationIds: [...r.classificationIds], possibleClassificationIds: [...(uncertain.get(r.sourceId) ?? [])],
        sameAthleteRoundFinishCount: duplicateCounts.get(`${r.roundId}:${r.athleteId}`) ?? 0,
        publishedRanks: { overall: publishedRank(original.rankOverall), gender: publishedRank(original.rankGender), ageCategory: publishedRank(original.rankAgeCategory) },
      };
    }), nextCursor: rows.length > 25 ? rows[24].sourceId : null,
  } };
  const decoded = decodeRewardSportingSource(response, f.scope, snapshotId, afterId);
  await checkRewardPreparationAccess(f.identity, f.scope, rpc); return decoded;
}
/** Minimum verified historical baseline. Freshness is still checked when saving. */
export async function getOrganizerSportingRecord(identity: RewardAccountIdentity, selection: RewardPreparationSelection,
  input: { snapshotId: string; approvalId: string }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), snapshotId = uuid(input.snapshotId), approvalId = uuid(input.approvalId);
  const bundle = await readRewardOperatorSportingContext(f.identity, f.scope, { snapshotId, recordApprovalIds: [approvalId] }, rpc);
  requireReward(bundle.context, "reward_sporting_source_required");
  const approval = decodeRewardRecordApproval(bundle.recordApprovals[0], { campaignId: f.scope.campaignId, actorUserId: f.identity.userId, approvalId });
  const verified = verifyStoredRewardRecordApproval(bundle.context, approval), b = verified.baseline;
  const result = decodeRewardSportingRecord({ ...f.scope, snapshotId, approvalId, raceId: verified.targetRaceId, gender: verified.gender,
    baseline: { approvalId, publicationId: b.publicationId, establishedAtMs: b.establishedAtMs.toString(), finishTimeMs: b.finishTimeMs.toString(), courseComparisonKey: b.courseComparisonKey } },
    { ...f.scope, snapshotId, approvalId });
  await checkRewardPreparationAccess(f.identity, f.scope, rpc); return result;
}
export async function captureOrganizerSportingSource(identity: RewardAccountIdentity, selection: RewardPreparationSelection,
  input: { idempotencyKey: string; confirmCapture: true }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), idempotencyKey = key(input.idempotencyKey);
  requireReward(input.confirmCapture === true, "invalid_reward_sporting_request");
  return captureRewardOperatorSource(f.identity, f.scope, idempotencyKey, rpc);
}

type Draft = { snapshotId: string; expectedRevision: number; review: unknown };
async function calculate(identity: RewardAccountIdentity, selection: RewardPreparationSelection, input: Draft, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), snapshotId = uuid(input.snapshotId), expectedRevision = revision(input.expectedRevision);
  let review;
  try { review = decodeRewardSportingReview(input.review); } catch { requireReward(false, "invalid_reward_sporting_request"); }
  const ids = review.roundReviews.flatMap(r => r.records.filter(d => d.baseline !== null).map(d => uuid(d.baseline!.approvalId)));
  const bundle = await readRewardOperatorSportingContext(f.identity, f.scope, { snapshotId, recordApprovalIds: ids }, rpc);
  requireReward(bundle.context, "reward_sporting_source_required");
  const context = bundle.context;
  const approvals: RewardLedgerRpc = async (name, args) => {
    requireReward(name === "service_read_reward_record_approval" && args.p_campaign_id === f.scope.campaignId
      && args.p_actor_user_id === f.identity.userId && Object.keys(args).length === 3, "reward_record_approval_mismatch");
    const packet = bundle.recordApprovals.find(r => r.approvalId === args.p_approval_id);
    requireReward(packet, "reward_record_approval_required"); return { data: packet, error: null };
  };
  const calculated = await calculateRewardSportingContext(context, review, approvals);
  const digest = createHash("sha256").update(JSON.stringify(copyRewardLedgerDocument({ schemaVersion: 1,
    scope: f.scope, snapshotId, expectedRevision, review, allocation: rewardAllocationRequest(calculated) }))).digest("hex");
  return { ...f, snapshotId, expectedRevision, review, calculated, digest, bundle };
}
export async function previewOrganizerSportingReview(identity: RewardAccountIdentity, selection: RewardPreparationSelection, input: Draft, rpc?: RewardLedgerRpc) {
  const c = await calculate(identity, selection, input, rpc), result = c.calculated.result;
  requireReward(c.bundle.allocationId === null, "reward_campaign_allocation_already_reserved");
  requireReward(c.expectedRevision === c.bundle.latestRevision, "reward_sporting_revision_changed");
  const response = { ...c.scope, snapshotId: c.snapshotId, expectedRevision: c.expectedRevision, previewDigest: c.digest,
    budgetWei: result.budgetWei.toString(), allocatedWei: (result.budgetWei - result.unallocatedWei).toString(),
    unallocatedWei: result.unallocatedWei.toString(), awardCount: aggregateRewardEntitlements(result).length,
    selectedFinishCount: c.calculated.selectedSourceIds.length, excludedFinishCount: result.excludedSourceIds.length,
    sourceReviewEndsAtSeconds: c.calculated.sourceReviewEndsAt.toString(),
    families: rewardPreviewFamilies(result.pot, result.budgetWei).map(f => ({ family: f.key, budgetWei: f.amount.toString(),
      allocatedWei: result.awards.filter(a => a.family === f.key).reduce((sum, a) => sum + a.amountWei, 0n).toString() })),
  };
  await checkRewardPreparationAccess(c.identity, c.scope, rpc); return response;
}
export async function submitOrganizerSportingReview(identity: RewardAccountIdentity, selection: RewardPreparationSelection,
  input: Draft & { previewDigest: string; idempotencyKey: string; confirmReview: true }, rpc?: RewardLedgerRpc) {
  const idempotencyKey = key(input.idempotencyKey), digest = input.previewDigest;
  requireReward(input.confirmReview === true && typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest), "invalid_reward_sporting_request");
  const c = await calculate(identity, selection, input, rpc);
  requireReward(digest === c.digest, "reward_sporting_preview_changed");
  // Do not replace the SQL revision/current-source check with this historical
  // computation. Exact retries remain valid after later reviews/allocations.
  return saveRewardOperatorSportingReview(c.identity, c.scope, { snapshotId: c.snapshotId, expectedRevision: c.expectedRevision,
    idempotencyKey, review: c.review }, rpc);
}
