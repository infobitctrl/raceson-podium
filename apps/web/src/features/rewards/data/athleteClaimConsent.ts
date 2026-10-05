import { apiRequest } from "@/lib/api";
import { requirePortal, rewardUuid } from "../model/athleteRewards";
import { decodeAthleteRewardClaim, type AthleteRewardClaim } from "../model/athleteClaims";
import { decodeAthleteClaimReview, decodeAthleteConsentReceipt, type AthleteClaimReview } from "../model/athleteClaimConsent";
import { athleteClaimsPath, requireClaimNetwork } from "./athleteClaims";

export async function getAthleteClaimReview(history: AthleteRewardClaim) {
  const fixed = decodeAthleteRewardClaim(history); requireClaimNetwork(fixed.chainId);
  return decodeAthleteClaimReview(await apiRequest<unknown>({ path: `${athleteClaimsPath}/${fixed.intentId}`, cache: "no-store" }), fixed);
}
export async function submitAthleteClaimConsent(review: AthleteClaimReview, signature: string, idempotencyKey: string) {
  const fixed = { ...review };
  requireClaimNetwork(fixed.chainId);
  requirePortal(rewardUuid(fixed.intentId) && /^0x[0-9a-f]{130}$/i.test(signature) && rewardUuid(idempotencyKey));
  return decodeAthleteConsentReceipt(await apiRequest<unknown>({ path: `${athleteClaimsPath}/${fixed.intentId}/consent`,
    method: "POST", cache: "no-store", body: { signature, idempotencyKey } }), fixed);
}
