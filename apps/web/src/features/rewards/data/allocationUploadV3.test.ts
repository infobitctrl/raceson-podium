import { beforeEach, expect, it, vi } from "vitest";
import { requestAllocationUploadV3 } from "./allocationUploadV3";
import { uploadContext, uploadWire } from "./allocationUploadV3.fixture";
const mocks = vi.hoisted(() => ({ api: vi.fn(), env: { rewardDemo: true, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.api(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.api.mockReset().mockResolvedValue(uploadWire()); mocks.env.rewardDemo = true; });
it("reads only a scoped no-store summary and requires the same acknowledgement for an exact preparation", async () => {
  const v = await requestAllocationUploadV3(uploadContext); expect(v.prepared).toBeNull();
  expect(mocks.api).toHaveBeenCalledWith({ path: `/v1/organizer/rewards/drafts/${uploadContext.draftId}/allocation-upload/1/${uploadContext.approvalId}`, cache: "no-store" });
  const wire = uploadWire(true); mocks.api.mockResolvedValue(wire);
  const request = { requestId: wire.prepared!.id, contextHash: uploadContext.contextHash, documentHash: uploadContext.documentHash };
  expect((await requestAllocationUploadV3(uploadContext, request)).prepared?.id).toBe(request.requestId);
  await expect(requestAllocationUploadV3(uploadContext, { ...request, requestId: uploadContext.draftId })).rejects.toThrow();
});
it("refuses cross-scope amounts, false payable flags, private exports and malformed preparation metadata", async () => {
  for (const patch of [{ chainId: 10143 }, { draftId: uploadContext.approvalId }, { slot: 2 }, { approvalId: uploadContext.draftId },
    { documentHash: "f".repeat(64) }, { contextHash: "f".repeat(64) }, { campaignAddress: `0x${"4".repeat(40)}` },
    { budgetWei: "1" }, { allocatedWei: "1" }, { unallocatedWei: "1" }, { entitlementCount: "21" }, { current: "true" },
    { stageReady: true }, { payableWei: "1" }, { snapshotSalt: "private" }, { prepared: { ...uploadWire(true).prepared, package: {} } },
    { prepared: { ...uploadWire(true).prepared, preparedAt: "never" } }]) {
    mocks.api.mockResolvedValue({ ...uploadWire(), ...patch }); await expect(requestAllocationUploadV3(uploadContext)).rejects.toThrow();
  }
});
it("preserves a held historical package and refuses non-demo or unsupported-chain requests before IO", async () => {
  mocks.api.mockResolvedValue({ ...uploadWire(true), current: false, contextHash: "d".repeat(64) });
  expect((await requestAllocationUploadV3(uploadContext)).current).toBe(false);
  mocks.api.mockClear(); mocks.env.rewardDemo = false;
  await expect(requestAllocationUploadV3(uploadContext)).rejects.toThrow(); expect(mocks.api).not.toHaveBeenCalled();
  mocks.env.rewardDemo = true;
  await expect(requestAllocationUploadV3({ ...uploadContext, chainId: 143 })).rejects.toThrow(); expect(mocks.api).not.toHaveBeenCalled();
});
