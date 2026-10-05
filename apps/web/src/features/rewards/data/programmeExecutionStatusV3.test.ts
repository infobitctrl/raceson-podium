import { beforeEach, expect, it, vi } from "vitest";
import { requestProgrammeExecutionStatusV3 } from "./programmeExecutionStatusV3";
import { executionContext, executionWire } from "./programmeExecutionStatusV3.fixture";
const mocks = vi.hoisted(() => ({ api: vi.fn(), env: { rewardDemo: true, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.api(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.api.mockReset().mockResolvedValue(executionWire()); mocks.env.rewardDemo = true; });
it("reads only exact stored scope without a body or wallet call", async () => {
  expect((await requestProgrammeExecutionStatusV3(executionContext)).steps).toHaveLength(2);
  expect(mocks.api).toHaveBeenCalledWith({ cache: "no-store", path: `/v1/organizer/rewards/drafts/${executionContext.draftId}/allocation-execution/1/${executionContext.approvalId}/${executionContext.uploadId}` });
});
it("rejects private fields, wrong chain, allocation, count and package bindings", async () => {
  for (const patch of [{ chainId: 10143 }, { entitlementCount: "21" }, { packageHash: "a".repeat(64) },
    { campaignAddress: `0x${"4".repeat(40)}` }, { documentHash: "a".repeat(64) }, { uploadId: executionContext.draftId }, { leaseToken: "private" }]) {
    mocks.api.mockResolvedValueOnce({ ...executionWire(), ...patch }); await expect(requestProgrammeExecutionStatusV3(executionContext)).rejects.toThrow();
  }
});
it("keeps historical holds but refuses production and unsupported requests before IO", async () => {
  mocks.api.mockResolvedValueOnce({ ...executionWire(), current: false }); expect((await requestProgrammeExecutionStatusV3(executionContext)).current).toBe(false);
  mocks.api.mockClear(); mocks.env.rewardDemo = false;
  await expect(requestProgrammeExecutionStatusV3(executionContext)).rejects.toThrow(); expect(mocks.api).not.toHaveBeenCalled();
  mocks.env.rewardDemo = true;
  await expect(requestProgrammeExecutionStatusV3({ ...executionContext, chainId: 143 })).rejects.toThrow(); expect(mocks.api).not.toHaveBeenCalled();
});
