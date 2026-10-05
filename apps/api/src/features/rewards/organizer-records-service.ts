import { createHash } from "node:crypto";
import { adaptRewardSourceEvidence, decodeRewardRecordComparison, decodeRewardRecordWorkspace, parseRewardUnits, requireReward,
  verifyRewardRecordCandidate, type RewardRecordSelection } from "@raceson/domain/rewards";
import { approveRewardOperatorRecord, captureRewardOperatorRecord, checkRewardPreparationAccess, copyRewardLedgerDocument,
  listRewardRecordRaces, readRewardRecordWorkspace, rewardDocumentUuid as uuid, rewardRecordApprovalRequest, rewardRecordComparisonWire,
  withdrawRewardOperatorRecord, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { verifyStoredRewardRecordApproval } from "./record-approval-service.js";

function fixed(identity: RewardAccountIdentity, selection: RewardRecordSelection) {
  requireReward(selection.chainId === 10143 || selection.chainId === 31337, "invalid_reward_record_request");
  return { identity: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, scope: { programmeId: uuid(selection.programmeId),
    campaignId: uuid(selection.campaignId), chainId: selection.chainId, snapshotId: uuid(selection.snapshotId) } };
}
function revision(v: unknown) { requireReward(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483645, "invalid_reward_record_request"); return v; }
function key(v: unknown) { requireReward(typeof v === "string" && v.length >= 8 && v.length <= 128, "invalid_reward_record_request"); return v; }
function raw(v: unknown): Record<string, unknown> { requireReward(v !== null && typeof v === "object" && !Array.isArray(v), "invalid_reward_record_workspace_document"); return v as Record<string, unknown>; }
function amount(v: unknown) { requireReward(typeof v === "string", "invalid_reward_record_workspace_document"); return parseRewardUnits(v, 0).toString(); }

export async function listOrganizerRecordRaces(identity: RewardAccountIdentity, selection: RewardRecordSelection, after: string | null, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), afterId = after === null ? null : uuid(after);
  const result = await listRewardRecordRaces(f.identity, f.scope, afterId, rpc);
  await checkRewardPreparationAccess(f.identity, f.scope, rpc); return result;
}
/** Read-only inspection is not a comparison approval. Raw identity paths,
 * registration provenance and source fingerprints stay in the private bundle. */
export async function getOrganizerRecordWorkspace(identity: RewardAccountIdentity, selection: RewardRecordSelection,
  input: { priorSnapshotId: string | null; afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), priorId = input.priorSnapshotId === null ? null : uuid(input.priorSnapshotId), after = input.afterId == null ? null : uuid(input.afterId);
  requireReward(priorId !== null || after === null, "invalid_reward_record_request");
  const bundle = await readRewardRecordWorkspace(f.identity, f.scope, priorId, rpc), c = bundle.context;
  const round = c.programme.configuration.rounds.find(r => r.id === c.campaign.scopeKey)!;
  adaptRewardSourceEvidence(c.snapshot, { ...c.programme.configuration, rounds: [round] });
  const targetSource = raw(c.snapshot.source), mappings = targetSource.mappings as Record<string, unknown>[];
  const targetRaces = round.races.map(r => ({ raceId: r.id, eventEditionId: round.eventEditionId,
    startAt: mappings.find(m => m.raceId === r.id)!.startAt, distanceMetres: r.distanceMetres.toString(),
    courseFormat: r.courseFormat, lapCount: r.lapCount, trackVersionId: r.trackVersionId }));
  let prior = null;
  if (bundle.priorSnapshot) {
    const packet = bundle.priorSnapshot, source = raw(packet.source), race = raw(source.race), track = raw(source.track), publication = raw(source.publication), run = raw(source.run);
    const all = source.rows as Record<string, unknown>[], cases = source.adjudicationCases as Record<string, unknown>[], names = new Map(bundle.names.map(n => [n.id, n.name]));
    const ordered = [...all].sort((a, b) => String(a.id).localeCompare(String(b.id))), page = ordered.filter(r => after === null || String(r.id) > after).slice(0, 26);
    prior = { priorSnapshotId: packet.snapshotId, capturedAt: packet.capturedAt,
      race: { raceId: race.id, eventEditionId: race.eventEditionId, startAt: race.startAt, distanceMetres: amount(race.distanceMetres),
        courseFormat: race.courseFormat, lapCount: race.lapCount, trackVersionId: track.versionId },
      publicationId: publication.id, publishedAt: publication.publishedAt, runCompletedAt: run.completedAt,
      resultCount: all.length, openCaseCount: cases.filter(r => !["closed", "withdrawn"].includes(String(r.state)) || r.recomputeRequired !== false).length,
      items: page.slice(0, 25).map(r => { const g = String(r.gender).trim().toUpperCase();
        return { sourceId: r.id, athleteId: r.canonicalAthleteId, athleteName: names.get(String(r.canonicalAthleteId)) ?? null,
          gender: ["M", "MALE"].includes(g) ? "M" : ["F", "FEMALE", "W"].includes(g) ? "F" : "U",
          participationStatus: r.participationStatus, resultStatus: r.resultStatus, finishTimeMs: r.finishTimeMs === null ? null : amount(r.finishTimeMs) }; }),
      nextCursor: page.length > 25 ? page[24].id : null };
  }
  const result = decodeRewardRecordWorkspace({ ...f.scope, allocationId: bundle.allocationId, targetRaces, latestApprovals: bundle.latestApprovals, prior }, f.scope, priorId, after);
  await checkRewardPreparationAccess(f.identity, f.scope, rpc); return result;
}
export async function captureOrganizerRecord(identity: RewardAccountIdentity, selection: RewardRecordSelection,
  input: { priorRaceId: string; idempotencyKey: string; confirmCapture: true }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), priorRaceId = uuid(input.priorRaceId), idempotencyKey = key(input.idempotencyKey);
  requireReward(input.confirmCapture === true, "invalid_reward_record_request");
  return captureRewardOperatorRecord(f.identity, f.scope, { priorRaceId, idempotencyKey }, rpc);
}
export type OrganizerRecordDraft = { priorSnapshotId: string; targetRaceId: string; baselineSourceId: string; gender: "M" | "F"; comparison: unknown; expectedRevision: number };
async function candidate(identity: RewardAccountIdentity, selection: RewardRecordSelection, input: OrganizerRecordDraft, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection), priorSnapshotId = uuid(input.priorSnapshotId), targetRaceId = uuid(input.targetRaceId), baselineSourceId = uuid(input.baselineSourceId),
    gender = input.gender, expectedRevision = revision(input.expectedRevision), comparison = rewardRecordComparisonWire(decodeRewardRecordComparison(input.comparison));
  requireReward(gender === "M" || gender === "F", "invalid_reward_record_request");
  const bundle = await readRewardRecordWorkspace(f.identity, f.scope, priorSnapshotId, rpc);
  requireReward(bundle.priorSnapshot, "reward_record_source_scope_mismatch");
  const verified = verifyRewardRecordCandidate({ campaignId: f.scope.campaignId, roundId: bundle.context.campaign.scopeKey,
    targetRaceId, baselineSourceId, gender, comparison, priorSnapshot: bundle.priorSnapshot,
    targetSnapshot: bundle.context.snapshot, configuration: bundle.context.programme.configuration });
  const body = rewardRecordApprovalRequest(verified), digest = createHash("sha256").update(JSON.stringify(copyRewardLedgerDocument({ schemaVersion: 1,
    scope: f.scope, priorSnapshotId, expectedRevision, candidate: body }))).digest("hex");
  return { ...f, bundle, verified, expectedRevision, digest };
}
export async function previewOrganizerRecord(identity: RewardAccountIdentity, selection: RewardRecordSelection, input: OrganizerRecordDraft, rpc?: RewardLedgerRpc) {
  const c = await candidate(identity, selection, input, rpc);
  requireReward(c.bundle.allocationId === null, "reward_campaign_allocation_already_reserved");
  const latest = c.bundle.latestApprovals.find(a => a.raceId === c.verified.targetRaceId && a.gender === c.verified.gender);
  requireReward(c.expectedRevision === (latest?.revision ?? 0), "reward_record_revision_changed");
  const b = c.verified.baseline;
  const result = { ...c.scope, priorSnapshotId: c.verified.priorSnapshotId, targetRaceId: c.verified.targetRaceId, baselineSourceId: c.verified.baselineSourceId,
    gender: c.verified.gender, expectedRevision: c.expectedRevision, previewDigest: c.digest,
    baseline: { publicationId: b.publicationId, establishedAtMs: b.establishedAtMs.toString(), finishTimeMs: b.finishTimeMs.toString(), courseComparisonKey: b.courseComparisonKey },
    sourceReviewEndsAtSeconds: c.verified.sourceReviewEndsAt.toString(), establishmentBasis: c.verified.establishmentBasis };
  await checkRewardPreparationAccess(c.identity, c.scope, rpc); return result;
}
export async function approveOrganizerRecord(identity: RewardAccountIdentity, selection: RewardRecordSelection,
  input: OrganizerRecordDraft & { previewDigest: string; idempotencyKey: string; confirmApproval: true }, rpc?: RewardLedgerRpc) {
  const idempotencyKey = key(input.idempotencyKey), digest = input.previewDigest;
  requireReward(input.confirmApproval === true && typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest), "invalid_reward_record_request");
  const c = await candidate(identity, selection, input, rpc);
  requireReward(digest === c.digest, "reward_record_preview_changed");
  const saved = await approveRewardOperatorRecord(c.identity, c.scope, { candidate: c.verified, expectedRevision: c.expectedRevision, idempotencyKey }, rpc);
  verifyStoredRewardRecordApproval(c.bundle.context, saved);
  await checkRewardPreparationAccess(c.identity, c.scope, rpc);
  return { ...c.scope, approvalId: saved.approvalId, priorSnapshotId: saved.priorSnapshotId, raceId: saved.body.targetRaceId,
    gender: saved.body.gender, revision: saved.revision, approvedAt: saved.approvedAt };
}
export async function withdrawOrganizerRecord(identity: RewardAccountIdentity, selection: RewardRecordSelection,
  input: { approvalId: string; expectedRevision: number; idempotencyKey: string; reason: string; confirmWithdrawal: true }, rpc?: RewardLedgerRpc) {
  const f = fixed(identity, selection); requireReward(input.confirmWithdrawal === true, "invalid_reward_record_request");
  return withdrawRewardOperatorRecord(f.identity, f.scope, input, rpc);
}
