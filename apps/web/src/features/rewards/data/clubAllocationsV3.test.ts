import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOwnClubAllocationsV3 } from "./clubAllocationsV3";
const mock=vi.hoisted(()=>({api:vi.fn(),network:vi.fn()}));
vi.mock("@/lib/api",()=>({apiRequest:mock.api}));
vi.mock("@/lib/public-env",()=>({publicEnv:{rewardDemo:{mode:"local"}}}));
vi.mock("./athleteClaims",()=>({requireClaimNetwork:mock.network}));
const clubId="81000000-0000-4000-8000-000000000008";
beforeEach(()=>{mock.api.mockReset().mockResolvedValue({schema:"raceson-club-allocations-v3",chainId:31337,clubId,items:[],nextCursor:null});mock.network.mockReset();});
describe("private club V3 read adapter",()=>{
  it("uses a no-store GET with only the selected club and rechecks the network",async()=>{
    await getOwnClubAllocationsV3(clubId);
    expect(mock.api).toHaveBeenCalledWith({path:`/v1/club/rewards/clubs/${clubId}/allocations-v3`,cache:"no-store"});
    expect(mock.network).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid selection/cursor before IO and foreign responses",async()=>{
    await expect(getOwnClubAllocationsV3("other")).rejects.toThrow();
    await expect(getOwnClubAllocationsV3(clubId,"other")).rejects.toThrow();expect(mock.api).not.toHaveBeenCalled();
    mock.api.mockResolvedValue({schema:"raceson-club-allocations-v3",chainId:10143,clubId,items:[],nextCursor:null});
    await expect(getOwnClubAllocationsV3(clubId)).rejects.toThrow();
  });
});
