import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparationFixture } from "../../../../../api/test/fixtures/reward-preparation.mjs";
import { getOrganizerPreparation, reserveOrganizerAllocation } from "./organizerPreparation";
const c = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: c.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { get mode() { return c.mode; } } } }));
function fixture() { const f = preparationFixture(); return { ...f, selection: { ...f.selection, chainId: 31337 as const }, request: { ...f.request, confirmAllocation: true as const } }; }
beforeEach(() => { c.api.mockReset(); c.enabled = true; c.mode = "local"; });
describe("private allocation preparation browser adapter", () => {
  it("uses scoped no-store reads and an explicit POST containing no browser amounts", async () => {
    const f = fixture(), base = `/v1/organizer/rewards/programmes/${f.selection.programmeId}/campaigns/${f.selection.campaignId}`;
    c.api.mockResolvedValue(f.view); expect(await getOrganizerPreparation(f.selection)).toEqual(f.view);
    expect(c.api).toHaveBeenLastCalledWith({ path: `${base}/preparation`, cache: "no-store" });
    c.api.mockResolvedValue(f.receipt); expect(await reserveOrganizerAllocation(f.selection, f.request)).toEqual(f.receipt);
    const { reviewId, ...body } = f.request;
    expect(c.api).toHaveBeenLastCalledWith({ path: `${base}/reviews/${reviewId}/reserve`, method: "POST", body, cache: "no-store" });
  });
  it("denies wrong networks, disabled features and malformed decisions before I/O", async () => {
    const f = fixture(); c.enabled = false; await expect(getOrganizerPreparation(f.selection)).rejects.toThrow(); c.enabled = true;
    await expect(getOrganizerPreparation({ ...f.selection, chainId: 10143 })).rejects.toThrow();
    await expect(getOrganizerPreparation(f.selection, "../private")).rejects.toThrow();
    await expect(reserveOrganizerAllocation(f.selection, { ...f.request, previewDigest: "bad" })).rejects.toThrow();
    expect(c.api).not.toHaveBeenCalled();
  });
  it("rejects private fields, mismatched receipts and configuration changes after I/O", async () => {
    const f = fixture(); c.api.mockResolvedValue({ ...f.view, context: {} }); await expect(getOrganizerPreparation(f.selection)).rejects.toThrow();
    c.api.mockResolvedValue({ ...f.receipt, reviewId: f.receipt.allocationId }); await expect(reserveOrganizerAllocation(f.selection, f.request)).rejects.toThrow();
    c.api.mockImplementation(async () => { c.mode = "testnet"; return f.receipt; });
    await expect(reserveOrganizerAllocation(f.selection, f.request)).rejects.toThrow();
  });
});
