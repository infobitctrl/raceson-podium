import { decodeRewardCampaigns, decodeRewardAwardPage, decodeRewardAwardDetail, rewardDistributionUuid as uuid,
  type RewardAllocationScope, type RewardAwardScope, type RewardDistributionScope } from "@raceson/domain/rewards";
import { apiRequest } from "@/lib/api";
import { publicEnv } from "@/lib/public-env";
import { requireClaimNetwork } from "./athleteClaims";

function scope(programmeId: string): RewardDistributionScope {
  const chainId = publicEnv.rewardDemo?.mode === "local" ? 31337 : 10143;
  requireClaimNetwork(chainId); return { programmeId: uuid(programmeId), chainId };
}
const base = (programmeId: string) => `/v1/organizer/rewards/programmes/${programmeId}/campaigns`;
const path = (s: RewardAllocationScope) => `${base(s.programmeId)}/${s.campaignId}/allocations/${s.allocationId}/awards`;
const cursor = (after: string | null) => after === null ? "" : `?after=${uuid(after)}`;
function allocation(input: RewardAllocationScope): RewardAllocationScope {
  const fixed = { ...scope(input.programmeId), campaignId: uuid(input.campaignId), allocationId: uuid(input.allocationId) };
  requireClaimNetwork(input.chainId); return fixed;
}
export async function getOrganizerCampaigns(programmeId: string) {
  const fixed = scope(programmeId);
  const raw = await apiRequest<unknown>({ path: base(fixed.programmeId), cache: "no-store" }); requireClaimNetwork(fixed.chainId);
  return decodeRewardCampaigns(raw, fixed);
}
export async function getOrganizerAwards(input: RewardAllocationScope, after: string | null = null) {
  const fixed = allocation(input), query = cursor(after);
  const raw = await apiRequest<unknown>({ path: path(fixed) + query, cache: "no-store" }); requireClaimNetwork(fixed.chainId);
  return decodeRewardAwardPage(raw, fixed, after);
}
export async function getOrganizerAwardEvidence(input: RewardAwardScope, after: string | null = null) {
  const fixed = { ...allocation(input), entitlementId: uuid(input.entitlementId) }, query = cursor(after);
  const raw = await apiRequest<unknown>({ path: `${path(fixed)}/${fixed.entitlementId}${query}`, cache: "no-store" }); requireClaimNetwork(fixed.chainId);
  return decodeRewardAwardDetail(raw, fixed, after);
}
