import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { requestAllocationApprovalV3 } from "./allocationApprovalV3";
import { allocationFixture } from "./allocationApprovalV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn(), env: { rewardDemo: true, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.request.mockReset(); mocks.env.rewardDemo = true; vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());
it("recomputes the per-pot document and its SHA-256 commitment over a private no-store read", async () => {
  const f = allocationFixture(); mocks.request.mockResolvedValue(f.wire);
  expect(await requestAllocationApprovalV3(f.context)).toEqual(f.data);
  expect(mocks.request).toHaveBeenCalledWith({ path: `/v1/organizer/rewards/drafts/${f.context.record.draftId}/allocation-approval/1`, cache: "no-store" });
});
it("rejects altered commitments, scope, payment flags, calculation and private extras", async () => {
  type Wire = ReturnType<typeof allocationFixture>["wire"];
  for (const mutate of [(v: Wire) => v.documentHash = "a".repeat(64), (v: Wire) => v.payableWei = "1", (v: Wire) => v.stageReady = true,
    (v: Wire) => v.document.recipients[0].amountWei = "1", (v: Wire) => v.document.record.chainId = 10143,
    (v: Wire) => v.secret = "never", (v: Wire) => v.reasons = ["unknown"]]) {
    const f = allocationFixture(); mutate(f.wire); mocks.request.mockResolvedValue(f.wire);
    await expect(requestAllocationApprovalV3(f.context)).rejects.toThrow();
  }
  mocks.env.rewardDemo = false; mocks.request.mockClear();
  await expect(requestAllocationApprovalV3(allocationFixture().context)).rejects.toThrow(); expect(mocks.request).not.toHaveBeenCalled();
});
it("sends only exact approval expectations and validates the recorded acknowledgement", async () => {
  const f = allocationFixture(), request = { requestId: "8c000000-0000-4000-8000-000000001002", expectedApprovalId: null,
    contextHash: f.data.contextHash, documentHash: f.data.documentHash };
  const approval = { id: request.requestId, previousApprovalId: null, contextHash: request.contextHash, documentHash: request.documentHash,
    document: f.wire.document, approvedAt: "2026-09-10T04:00:00Z", approvedByUserId: "8c000000-0000-4000-8000-000000001003", current: true };
  f.wire.approval = approval; f.wire.recorded = approval; mocks.request.mockResolvedValue(f.wire);
  expect((await requestAllocationApprovalV3(f.context, request)).recorded?.id).toBe(request.requestId);
  expect(mocks.request.mock.calls[0][0].body).toEqual(request);
  await expect(requestAllocationApprovalV3(f.context, { ...request, expectedApprovalId: approval.id })).rejects.toThrow();
});
it("retains the verified original approved document when a source hold makes the latest preview different", async () => {
  const f = allocationFixture();
  f.wire.approval = { id: "8c000000-0000-4000-8000-000000001002", previousApprovalId: null, contextHash: "c".repeat(64),
    documentHash: f.data.documentHash, document: f.wire.document, approvedAt: "2026-09-10T04:00:00Z",
    approvedByUserId: "8c000000-0000-4000-8000-000000001003", current: false };
  mocks.request.mockResolvedValue(f.wire);
  const result = await requestAllocationApprovalV3(f.context);
  expect(result.approval?.current).toBe(false); expect(result.approval?.document).toEqual(f.data.document);
  expect(result.approval?.contextHash).toBe("c".repeat(64));
});
