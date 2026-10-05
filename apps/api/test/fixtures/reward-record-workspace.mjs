import { recordFixture } from "./reward-record.mjs";
import { rewardId as id } from "./reward-calculation.mjs";
import * as service from "../../dist/features/rewards/organizer-records-service.js";

/** Synthetic browser fixture, projected and previewed by the actual service. */
export async function recordWorkspaceFixture() {
  const f = recordFixture(), identity = { userId: f.actorId, sessionId: id(98620) };
  const scope = { programmeId: f.context.programme.id, campaignId: f.campaignId, chainId: 31337, snapshotId: f.snapshotId };
  const bundle = { context: { ...f.context, review: null }, priorSnapshot: f.priorSnapshot,
    names: f.priorSnapshot.source.rows.map((r, i) => ({ id: r.canonicalAthleteId, name: `Synthetic prior runner ${i + 1}` })), latestApprovals: [], allocationId: null };
  const racePage = { ...scope, items: [{ raceId: f.input.priorRaceId, raceName: "Synthetic prior 5 km", eventEditionId: id(60000),
    eventName: "Synthetic prior edition", startAt: "2025-06-01T08:00:00Z", distanceMetres: "5000", latestCaptureId: f.priorSnapshot.snapshotId }], nextCursor: null };
  const draft = { priorSnapshotId: f.priorSnapshot.snapshotId, targetRaceId: f.input.targetRaceId, baselineSourceId: f.input.baselineSourceId,
    gender: "M", expectedRevision: 0, comparison: f.comparison };
  const capture = { ...scope, priorRaceId: f.input.priorRaceId, priorSnapshotId: f.priorSnapshot.snapshotId, capturedAt: f.priorSnapshot.capturedAt };
  const saved = { ...scope, approvalId: id(61000), priorSnapshotId: draft.priorSnapshotId, raceId: draft.targetRaceId, gender: "M", revision: 1, approvedAt: "2026-06-02T13:00:00Z" };
  const latest = { approvalId: saved.approvalId, snapshotId: scope.snapshotId, priorSnapshotId: draft.priorSnapshotId, raceId: draft.targetRaceId,
    gender: "M", revision: 1, approvedAt: saved.approvedAt, withdrawnAt: null };
  const withdrawal = { ...scope, approvalId: saved.approvalId, withdrawalId: id(61001), withdrawnAt: "2026-06-03T10:00:00Z" };
  const rpc = async (name, args) => {
    if (name === "service_check_reward_operator_preparation") return { data: { programmeId: scope.programmeId, campaignId: scope.campaignId, chainId: scope.chainId }, error: null };
    if (name === "service_read_reward_operator_record_context") return { data: structuredClone({ ...bundle, names: args.p_prior_snapshot_id ? bundle.names : [], priorSnapshot: args.p_prior_snapshot_id ? bundle.priorSnapshot : null }), error: null };
    if (name === "service_list_reward_operator_record_races") return { data: structuredClone(racePage), error: null };
    throw Error(`Unexpected synthetic record RPC: ${name}`);
  };
  const read = (priorSnapshotId = null, afterId = null) => service.getOrganizerRecordWorkspace(identity, scope, { priorSnapshotId, afterId }, rpc);
  const preview = input => service.previewOrganizerRecord(identity, scope, input, rpc);
  const view = await read(), priorView = await read(draft.priorSnapshotId), verified = await preview(draft);
  const record = { ...scope, approvalId: saved.approvalId, raceId: draft.targetRaceId, gender: "M", baseline: { ...verified.baseline, approvalId: saved.approvalId } };
  return { f, identity, scope, bundle, racePage, draft, capture, saved, latest, withdrawal, rpc, read, preview, view, priorView, verified, record };
}
