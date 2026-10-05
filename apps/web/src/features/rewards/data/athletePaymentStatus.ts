import { apiRequest } from "@/lib/api";
import { decodeAthleteRewardClaim, type AthleteRewardClaim } from "../model/athleteClaims";
import { decodeAthletePaymentStatus } from "../model/athletePaymentStatus";
import { athleteClaimsPath, requireClaimNetwork } from "./athleteClaims";

export async function getAthletePaymentStatus(history: AthleteRewardClaim) {
  const fixed = decodeAthleteRewardClaim(history); requireClaimNetwork(fixed.chainId);
  const response = await apiRequest<unknown>({ path: `${athleteClaimsPath}/${fixed.intentId}/payment`, cache: "no-store" });
  requireClaimNetwork(fixed.chainId);
  return decodeAthletePaymentStatus(response, fixed);
}
