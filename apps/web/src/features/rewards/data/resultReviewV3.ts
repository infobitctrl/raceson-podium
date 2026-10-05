import { decodeRewardResultReviewV3 } from "@raceson/domain/rewards/result-review-v3";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal } from "../model/athleteRewards";

export async function resultReviewV3(categoryId: string, organizationId: string, change?: { expectedRevision: number; reviewSeconds: number }) {
  requirePortal(publicEnv.rewardDemo && publicEnv.rewardPortalEnabled);
  requirePortal(/^[0-9a-f-]{36}$/.test(categoryId));
  const value = decodeRewardResultReviewV3(await apiRequest<unknown>({ path: `/v1/organizer/rewards/result-review/${categoryId}`,
    cache: "no-store", ...(change ? { method: "PATCH", body: { ...change } } : {}) }));
  requirePortal(value.categoryId === categoryId && value.organizationId === organizationId);
  return value;
}
