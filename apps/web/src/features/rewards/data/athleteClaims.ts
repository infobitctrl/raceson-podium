import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requirePortal, rewardUuid } from "../model/athleteRewards";
import { decodeAthleteRewardClaims } from "../model/athleteClaims";

export const athleteClaimsPath = "/v1/athlete/rewards/claims";
export function requireClaimNetwork(chainId: number) {
  requirePortal(publicEnv.rewardPortalEnabled && publicEnv.rewardDemo !== null
    && chainId === (publicEnv.rewardDemo.mode === "local" ? 31337 : 10143));
}
export async function getOwnAthleteClaims(after: string | null = null) {
  requirePortal(publicEnv.rewardPortalEnabled && publicEnv.rewardDemo !== null && (after === null || rewardUuid(after)));
  const page = decodeAthleteRewardClaims(await apiRequest<unknown>({
    path: `${athleteClaimsPath}${after ? `?after=${encodeURIComponent(after)}` : ""}`, cache: "no-store",
  }), after);
  page.items.forEach(item => requireClaimNetwork(item.chainId)); return page;
}
