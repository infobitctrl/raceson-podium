import { decodeRewardRecordComparison, type RewardRecordWorkspaceView, type RewardRecordRacePage, type RewardRecordDraftReference } from "@raceson/domain/rewards";

export const comparisonChoices = ["priorDirection", "targetDirection", "priorTimingMethod", "targetTimingMethod", "priorTimingBasis", "targetTimingBasis", "priorPrecisionMs", "targetPrecisionMs"] as const;
export type RecordComparisonDraft = Record<typeof comparisonChoices[number], string> & { courseEquivalent: boolean; historyReviewed: boolean; exceptionsReviewed: boolean; rationale: string };
export const emptyRecordComparison = (): RecordComparisonDraft => ({ priorDirection: "", targetDirection: "", priorTimingMethod: "", targetTimingMethod: "",
  priorTimingBasis: "", targetTimingBasis: "", priorPrecisionMs: "", targetPrecisionMs: "", courseEquivalent: false, historyReviewed: false, exceptionsReviewed: false, rationale: "" });
export type RecordComparisonWire = Omit<ReturnType<typeof decodeRewardRecordComparison>, "priorPrecisionMs" | "targetPrecisionMs"> & { priorPrecisionMs: string; targetPrecisionMs: string };
export type RecordApprovalRequest = RewardRecordDraftReference & { comparison: RecordComparisonWire };
export type RecordApprovalConfirmation = RecordApprovalRequest & { previewDigest: string; idempotencyKey: string; confirmApproval: true };
export type RecordCaptureConfirmation = { priorRaceId: string; idempotencyKey: string; confirmCapture: true };
export type RecordWithdrawalConfirmation = { approvalId: string; expectedRevision: number; idempotencyKey: string; reason: string; confirmWithdrawal: true };
export type RecordPending = { kind: "capture"; request: RecordCaptureConfirmation } | { kind: "approval"; request: RecordApprovalConfirmation } | { kind: "withdrawal"; request: RecordWithdrawalConfirmation };

export function buildRecordApproval(view: RewardRecordWorkspaceView, raceId: string, gender: "M" | "F", baselineSourceId: string, comparison: RecordComparisonDraft): RecordApprovalRequest {
  const p = view.prior;
  if (!p || p.nextCursor !== null || p.items.length !== p.resultCount) throw Error("record_load_all");
  const selected = p.items.find(r => r.sourceId === baselineSourceId);
  if (!view.targetRaces.some(r => r.raceId === raceId) || !selected || selected.gender !== gender || selected.participationStatus !== "finished"
    || !["official", "corrected"].includes(selected.resultStatus) || !selected.finishTimeMs || BigInt(selected.finishTimeMs) <= 0n) throw Error("record_baseline_required");
  if (p.openCaseCount) throw Error("record_open_cases");
  // Human review is never prechecked. The server still verifies the whole prior
  // population, exact comparison, fastest result and original source packets.
  let decoded; try { decoded = decodeRewardRecordComparison(comparison); } catch { throw Error("record_comparison_required"); }
  return { priorSnapshotId: p.priorSnapshotId, targetRaceId: raceId, gender, baselineSourceId,
    expectedRevision: view.latestApprovals.find(a => a.raceId === raceId && a.gender === gender)?.revision ?? 0,
    comparison: { ...decoded, priorPrecisionMs: decoded.priorPrecisionMs.toString(), targetPrecisionMs: decoded.targetPrecisionMs.toString() } };
}
export function mergeRecordResults(old: RewardRecordWorkspaceView, next: RewardRecordWorkspaceView) {
  if (!old.prior || !next.prior) throw Error("invalid_reward_record_workspace_document");
  const { items: before, nextCursor: oldCursor, ...oldPrior } = old.prior, { items: after, nextCursor: ignoredCursor, ...newPrior } = next.prior;
  const { prior: ignoredOld, ...oldMeta } = old, { prior: ignoredNew, ...newMeta } = next;
  if (!oldCursor || JSON.stringify(oldMeta) !== JSON.stringify(newMeta) || JSON.stringify(oldPrior) !== JSON.stringify(newPrior)
    || !after.length || before.at(-1)!.sourceId >= after[0].sourceId) throw Error("invalid_reward_record_workspace_document");
  const items = [...before, ...after];
  if (items.length > next.prior.resultCount || (next.prior.nextCursor === null && items.length !== next.prior.resultCount)) throw Error("invalid_reward_record_workspace_document");
  return { ...next, prior: { ...next.prior, items } };
}
export function mergeRecordRaces(old: RewardRecordRacePage, next: RewardRecordRacePage) {
  if (!old.nextCursor || old.programmeId !== next.programmeId || old.campaignId !== next.campaignId || old.snapshotId !== next.snapshotId || old.chainId !== next.chainId
    || (next.items.length && old.items.at(-1)!.raceId >= next.items[0].raceId)) throw Error("invalid_reward_record_workspace_document");
  return { ...next, items: [...old.items, ...next.items] };
}
