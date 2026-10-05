import { beforeEach, describe, expect, it, vi } from "vitest";
import { distributionFixture } from "../../../../../api/test/fixtures/reward-distribution.mjs";
import { getOrganizerCampaigns, getOrganizerAwards, getOrganizerAwardEvidence } from "./organizerDistribution";
const controls = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: controls.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return controls.enabled; }, rewardDemo: { get mode() { return controls.mode; } } } }));
beforeEach(() => { controls.api.mockReset(); controls.enabled = true; controls.mode = "local"; });
describe("private distribution browser requests", () => {
  it("uses exact programme/campaign/allocation/award scope with no-store reads", async () => {
    const f = distributionFixture(), allocation = { ...f.allocation, chainId: 31337 as const }, selected = { ...f.selected, chainId: 31337 as const };
    const base = `/v1/organizer/rewards/programmes/${f.scope.programmeId}/campaigns`;
    controls.api.mockResolvedValue(f.campaigns); expect(await getOrganizerCampaigns(f.scope.programmeId)).toEqual(f.campaigns);
    expect(controls.api).toHaveBeenLastCalledWith({ path: base, cache: "no-store" });
    controls.api.mockResolvedValue(f.page); expect(await getOrganizerAwards(allocation)).toEqual(f.page);
    const path = `${base}/${allocation.campaignId}/allocations/${allocation.allocationId}/awards`;
    expect(controls.api).toHaveBeenLastCalledWith({ path, cache: "no-store" });
    controls.api.mockResolvedValue(f.detail); expect(await getOrganizerAwardEvidence(selected)).toEqual(f.detail);
    expect(controls.api).toHaveBeenLastCalledWith({ path: `${path}/${selected.entitlementId}`, cache: "no-store" });
  });
  it("rejects disabled, malformed and wrong-network requests before IO and configuration drift after IO", async () => {
    const f = distributionFixture(); controls.enabled = false; await expect(getOrganizerCampaigns(f.scope.programmeId)).rejects.toThrow();
    controls.enabled = true; await expect(getOrganizerCampaigns("../private")).rejects.toThrow();
    await expect(getOrganizerAwards({ ...f.allocation, chainId: 10143 })).rejects.toThrow();
    await expect(getOrganizerAwardEvidence({ ...f.selected, chainId: 31337 }, "bad")).rejects.toThrow(); expect(controls.api).not.toHaveBeenCalled();
    controls.api.mockImplementation(async () => { controls.mode = "testnet"; return f.campaigns; });
    await expect(getOrganizerCampaigns(f.scope.programmeId)).rejects.toThrow();
  });
  it("rejects leaked private fields and foreign award responses", async () => {
    const f = distributionFixture(); controls.api.mockResolvedValue({ ...f.detail, snapshotSalt: "private" });
    await expect(getOrganizerAwardEvidence({ ...f.selected, chainId: 31337 })).rejects.toThrow();
    controls.api.mockResolvedValue({ ...f.detail, entitlementId: f.detail.beneficiaryId });
    await expect(getOrganizerAwardEvidence({ ...f.selected, chainId: 31337 })).rejects.toThrow();
  });
});
