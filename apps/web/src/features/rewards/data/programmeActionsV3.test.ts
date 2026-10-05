import { beforeEach, expect, it, vi } from "vitest";
import { requestProgrammeActionsV3 as request } from "./programmeActionsV3";
import { actionsContext as context, actionsFixture, actionFees } from "./programmeActionsV3.fixture";
const mocks = vi.hoisted(() => ({ api: vi.fn(), env: { rewardDemo: true, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.api(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.api.mockReset().mockResolvedValue(actionsFixture()); mocks.env.rewardDemo = true; });
const prepare = () => ({ kind: "prepare" as const, requestId: "8d000000-0000-4000-8000-000000000010", expectedPredecessorId: null,
  packageHash: context.packageHash, fees: { ...actionFees } });
it("GET reads exact scope and POST checks its immutable acknowledgement", async () => {
  await request(context); expect(mocks.api).toHaveBeenCalledWith({ cache: "no-store",
    path: `/v1/organizer/rewards/drafts/${context.draftId}/allocation-actions/1/${context.approvalId}/${context.uploadId}` });
  const change = prepare(); mocks.api.mockResolvedValueOnce({ ...actionsFixture("reserved"), ack: { kind: change.kind, requestId: change.requestId } });
  await request(context, change); expect(mocks.api.mock.calls[1]![0]).toMatchObject({ method: "POST", body: change });
  await expect(request(context, change)).rejects.toThrow();
});
it("rejects private fields, mismatched source/network and invalid requests before transport", async () => {
  for (const patch of [{ chainId: 10143 }, { entitlementCount: "21" }, { packageHash: "a".repeat(64) }, { documentHash: "a".repeat(64) },
    { campaignAddress: `0x${"6".repeat(40)}` }, { uploadId: context.draftId }]) {
    mocks.api.mockResolvedValueOnce({ ...actionsFixture(), execution: { ...actionsFixture().execution, ...patch } }); await expect(request(context)).rejects.toThrow();
  }
  mocks.api.mockResolvedValueOnce({ ...actionsFixture(), signedTransaction: "secret" }); await expect(request(context)).rejects.toThrow();
  mocks.api.mockClear(); mocks.env.rewardDemo = false; await expect(request(context)).rejects.toThrow(); expect(mocks.api).not.toHaveBeenCalled();
  mocks.env.rewardDemo = true; await expect(request(context, { ...prepare(), packageHash: "a".repeat(64) })).rejects.toThrow(); expect(mocks.api).not.toHaveBeenCalled();
});
it("captures submitted limits and scope before asynchronous transport", async () => {
  const input = { ...context }, change = prepare(), original = structuredClone(change);
  mocks.api.mockImplementationOnce(async () => { input.uploadId = input.draftId; change.fees.gasLimit = "1";
    return { ...actionsFixture("reserved"), ack: { kind: original.kind, requestId: original.requestId } }; });
  await request(input, change); expect(mocks.api.mock.calls[0]![0].body).toEqual(original);
});
