import { apiRequest } from "@/lib/api";
import { decodeOrganizerClubAwardsV3, organizerClubCursorV3, type OrganizerClubAwardScopeV3 } from "@raceson/domain/rewards/organizer-club-awards-v3";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardUuid } from "../model/athleteRewards";
export async function getOrganizerClubAwardsV3(input: OrganizerClubAwardScopeV3, after: string | null = null) {
  const c = { ...input }; requireClaimNetwork(c.chainId);
  requirePortal(rewardUuid(c.uploadId) && rewardUuid(c.draftId) && rewardUuid(c.approvalId) && (after === null || organizerClubCursorV3(after)));
  const raw = await apiRequest<unknown>({ path: `/v1/organizer/rewards/uploads/${c.uploadId}/club-awards-v3${after ? `?after=${after}` : ""}`, cache: "no-store" });
  requireClaimNetwork(c.chainId);
  const page = decodeOrganizerClubAwardsV3(raw,c.chainId,c.uploadId,after);
  requirePortal(page.draftId === c.draftId && page.approvalId === c.approvalId && page.slot === c.slot && page.campaignAddress === c.campaignAddress);
  return page;
}
