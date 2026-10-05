import { decodeClubPortalPage, decodeClubRewardAward, decodeClubRewardClaim, decodeClubRewardPayment, type ClubRewardClaim } from "@raceson/domain/rewards";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";
const network = () => { const id = publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143; requireClaimNetwork(id); return id; };
function cursor(after: string | null) { requirePortal(after === null || rewardUuid(after)); return after ? `?after=${encodeURIComponent(after)}` : ""; }
export async function getClubAwards(clubId: string, after: string | null = null) {
  const chainId = network(), query = cursor(after); requirePortal(rewardUuid(clubId));
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/club-awards/${clubId}${query}`, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeClubPortalPage(raw, after, v => { const r = decodeClubRewardAward(v, chainId); requirePortal(r.clubId === clubId); return r; }, r => r.entitlementId);
}
export async function getClubClaims(after: string | null = null) {
  const chainId = network(), query = cursor(after);
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/club-claims${query}`, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeClubPortalPage(raw, after, v => decodeClubRewardClaim(v, chainId), r => r.intentId);
}
export async function getClubPaymentStatus(history: ClubRewardClaim) {
  const chainId = network(), fixed = decodeClubRewardClaim(history, chainId);
  const raw = await apiRequest<unknown>({ path: `/v1/athlete/rewards/club-claims/${fixed.intentId}/payment`, cache: "no-store" }); requireClaimNetwork(chainId);
  return decodeClubRewardPayment(raw, fixed);
}
