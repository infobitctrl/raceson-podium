import { decodeRewardSportingSource, decodeRewardSportingCapture, decodeRewardSportingPreview, decodeRewardSportingSaved,
  decodeRewardSportingRecord, rewardDistributionUuid as uuid, type RewardPreparationSelection } from "@raceson/domain/rewards";
import { apiRequest } from "@/lib/api";
import { requireClaimNetwork } from "./athleteClaims";
import type { SportingReviewRequest, SportingReviewConfirmation } from "../model/organizerSportingDraft";

function scope(input: RewardPreparationSelection) {
  requireClaimNetwork(input.chainId); return { programmeId: uuid(input.programmeId), campaignId: uuid(input.campaignId), chainId: input.chainId };
}
const base = (s: RewardPreparationSelection) => `/v1/organizer/rewards/programmes/${s.programmeId}/campaigns/${s.campaignId}/sources`;
export async function getOrganizerSportingSource(input: RewardPreparationSelection, snapshotId: string | null = null, after: string | null = null) {
  const s = scope(input), id = snapshotId === null ? null : uuid(snapshotId), cursor = after === null ? null : uuid(after);
  if (cursor && !id) throw Error("invalid_reward_sporting_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}${id ? `/${id}` : ""}${cursor ? `?after=${cursor}` : ""}`, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardSportingSource(raw, s, id, cursor);
}
export async function captureOrganizerSportingSource(input: RewardPreparationSelection, confirmation: { idempotencyKey: string; confirmCapture: true }) {
  const s = scope(input), body = { idempotencyKey: confirmation.idempotencyKey, confirmCapture: confirmation.confirmCapture };
  if (body.confirmCapture !== true || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 128) throw Error("invalid_reward_sporting_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}/capture`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardSportingCapture(raw, s);
}
function request(input: SportingReviewRequest) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483645) throw Error("invalid_reward_sporting_request");
  return { snapshotId: uuid(input.snapshotId), expectedRevision: input.expectedRevision, review: structuredClone(input.review) };
}
export async function previewOrganizerSportingReview(input: RewardPreparationSelection, draft: SportingReviewRequest, pot: "race" | "league") {
  const s = scope(input), fixed = request(draft), { snapshotId, ...body } = fixed;
  const raw = await apiRequest<unknown>({ path: `${base(s)}/${snapshotId}/review-preview`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardSportingPreview(raw, { ...s, ...fixed }, pot);
}
export async function submitOrganizerSportingReview(input: RewardPreparationSelection, confirmation: SportingReviewConfirmation) {
  const s = scope(input), fixed = request(confirmation), { snapshotId, ...draft } = fixed;
  const body = { ...draft, previewDigest: confirmation.previewDigest, idempotencyKey: confirmation.idempotencyKey, confirmReview: confirmation.confirmReview };
  if (body.confirmReview !== true || !/^[0-9a-f]{64}$/.test(body.previewDigest) || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 128) throw Error("invalid_reward_sporting_request");
  const raw = await apiRequest<unknown>({ path: `${base(s)}/${snapshotId}/reviews`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardSportingSaved(raw, { ...s, snapshotId });
}
export async function getOrganizerSportingRecord(input: RewardPreparationSelection, snapshotId: string, approvalId: string) {
  const s = scope(input), fixed = { ...s, snapshotId: uuid(snapshotId), approvalId: uuid(approvalId) };
  const raw = await apiRequest<unknown>({ path: `${base(s)}/${fixed.snapshotId}/record-approvals/${fixed.approvalId}`, cache: "no-store" });
  requireClaimNetwork(s.chainId); return decodeRewardSportingRecord(raw, fixed);
}
