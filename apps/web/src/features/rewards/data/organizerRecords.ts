import { decodeRewardRecordRacePage, decodeRewardRecordWorkspace, decodeRewardRecordCapture, decodeRewardRecordComparison,
  decodeRewardRecordPreview, decodeRewardRecordSaved, decodeRewardRecordWithdrawal, rewardDistributionUuid as uuid,
  type RewardRecordSelection } from "@raceson/domain/rewards";
import { apiRequest } from "@/lib/api";
import { requireClaimNetwork } from "./athleteClaims";
import type { RecordApprovalRequest, RecordApprovalConfirmation, RecordCaptureConfirmation, RecordWithdrawalConfirmation } from "../model/organizerRecords";

function scope(input: RewardRecordSelection) {
  requireClaimNetwork(input.chainId); return { programmeId: uuid(input.programmeId), campaignId: uuid(input.campaignId), chainId: input.chainId, snapshotId: uuid(input.snapshotId) };
}
const base = (s: RewardRecordSelection) => `/v1/organizer/rewards/programmes/${s.programmeId}/campaigns/${s.campaignId}/sources/${s.snapshotId}`;
function key(v: unknown) { if (typeof v !== "string" || v.length < 8 || v.length > 128) throw Error("invalid_reward_record_request"); return v; }
function request(input: RecordApprovalRequest) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483645 || !["M", "F"].includes(input.gender)) throw Error("invalid_reward_record_request");
  const c = decodeRewardRecordComparison(input.comparison);
  return { priorSnapshotId: uuid(input.priorSnapshotId), targetRaceId: uuid(input.targetRaceId), baselineSourceId: uuid(input.baselineSourceId),
    gender: input.gender, expectedRevision: input.expectedRevision, comparison: { ...c, priorPrecisionMs: c.priorPrecisionMs.toString(), targetPrecisionMs: c.targetPrecisionMs.toString() } };
}
export async function listOrganizerRecordRaces(input: RewardRecordSelection, after: string | null = null) {
  const s = scope(input), cursor = after === null ? null : uuid(after);
  const raw = await apiRequest<unknown>({ path: `${base(s)}/record-races${cursor ? `?after=${cursor}` : ""}`, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardRecordRacePage(raw, s, cursor);
}
export async function getOrganizerRecordWorkspace(input: RewardRecordSelection, priorSnapshotId: string | null = null, after: string | null = null) {
  const s = scope(input), prior = priorSnapshotId === null ? null : uuid(priorSnapshotId), cursor = after === null ? null : uuid(after);
  if (cursor && !prior) throw Error("invalid_reward_record_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}/${prior ? `record-captures/${prior}` : "record-workspace"}${cursor ? `?after=${cursor}` : ""}`, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardRecordWorkspace(raw, s, prior, cursor);
}
export async function captureOrganizerRecord(input: RewardRecordSelection, confirmation: RecordCaptureConfirmation) {
  const s = scope(input), body = { priorRaceId: uuid(confirmation.priorRaceId), idempotencyKey: key(confirmation.idempotencyKey), confirmCapture: confirmation.confirmCapture };
  if (body.confirmCapture !== true) throw Error("invalid_reward_record_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}/record-captures`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardRecordCapture(raw, { ...s, priorRaceId: body.priorRaceId });
}
export async function previewOrganizerRecord(input: RewardRecordSelection, draft: RecordApprovalRequest) {
  const s = scope(input), body = request(draft);
  const raw = await apiRequest<unknown>({ path: `${base(s)}/record-preview`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardRecordPreview(raw, s, body);
}
export async function approveOrganizerRecord(input: RewardRecordSelection, confirmation: RecordApprovalConfirmation) {
  const s = scope(input), body = { ...request(confirmation), previewDigest: confirmation.previewDigest, idempotencyKey: key(confirmation.idempotencyKey), confirmApproval: confirmation.confirmApproval };
  if (body.confirmApproval !== true || !/^[0-9a-f]{64}$/.test(body.previewDigest)) throw Error("invalid_reward_record_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}/record-approvals`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardRecordSaved(raw, s, body);
}
export async function withdrawOrganizerRecord(input: RewardRecordSelection, confirmation: RecordWithdrawalConfirmation) {
  const s = scope(input), approvalId = uuid(confirmation.approvalId), body = { expectedRevision: confirmation.expectedRevision,
    idempotencyKey: key(confirmation.idempotencyKey), reason: confirmation.reason.trim(), confirmWithdrawal: confirmation.confirmWithdrawal };
  if (body.confirmWithdrawal !== true || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 || body.expectedRevision > 2147483646
    || body.reason.length < 8 || body.reason.length > 4000) throw Error("invalid_reward_record_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}/record-approvals/${approvalId}/withdraw`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardRecordWithdrawal(raw, s, approvalId);
}
