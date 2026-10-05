import { clubAllocationCursorV3, decodeClubAllocationsV3 } from "@raceson/domain/rewards/club-allocations-v3";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";

export async function getOwnClubAllocationsV3(clubId: string, after: string | null = null) {
  const chainId = publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143;
  requireClaimNetwork(chainId);
  requirePortal(rewardUuid(clubId) && (after === null || clubAllocationCursorV3(after)));
  const raw = await apiRequest<unknown>({ path: `/v1/club/rewards/clubs/${clubId}/allocations-v3${after ? `?after=${encodeURIComponent(after)}` : ""}`, cache: "no-store" });
  requireClaimNetwork(chainId);
  return decodeClubAllocationsV3(raw, chainId, clubId, after);
}
