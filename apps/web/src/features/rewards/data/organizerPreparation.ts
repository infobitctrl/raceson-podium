import { decodeRewardPreparation, decodeRewardReservation, rewardDistributionUuid as uuid, rewardPreviewCursor,
  type RewardPreparationSelection } from "@raceson/domain/rewards";
import { apiRequest } from "@/lib/api";
import { requireClaimNetwork } from "./athleteClaims";

export type RewardReservationConfirmation = { reviewId: string; previewDigest: string; idempotencyKey: string; confirmAllocation: true };
function scope(input: RewardPreparationSelection) {
  requireClaimNetwork(input.chainId);
  return { programmeId: uuid(input.programmeId), campaignId: uuid(input.campaignId), chainId: input.chainId };
}
const base = (s: RewardPreparationSelection) => `/v1/organizer/rewards/programmes/${s.programmeId}/campaigns/${s.campaignId}`;
export async function getOrganizerPreparation(input: RewardPreparationSelection, after: string | null = null) {
  const fixed = scope(input), cursor = after === null ? null : rewardPreviewCursor(after);
  const raw = await apiRequest<unknown>({ path: `${base(fixed)}/preparation${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); return decodeRewardPreparation(raw, fixed, cursor);
}
export async function reserveOrganizerAllocation(input: RewardPreparationSelection, confirmation: RewardReservationConfirmation) {
  const fixed = scope(input), reviewId = uuid(confirmation.reviewId);
  const body = { previewDigest: confirmation.previewDigest, idempotencyKey: confirmation.idempotencyKey, confirmAllocation: confirmation.confirmAllocation };
  if (!/^[0-9a-f]{64}$/.test(body.previewDigest) || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 128 || body.confirmAllocation !== true)
    throw Error("invalid_reward_preparation_request");
  const raw = await apiRequest<unknown>({ path: `${base(fixed)}/reviews/${reviewId}/reserve`, method: "POST", body, cache: "no-store" });
  requireClaimNetwork(fixed.chainId); return decodeRewardReservation(raw, { ...fixed, reviewId });
}
