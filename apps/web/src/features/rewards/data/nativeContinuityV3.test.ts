import { beforeEach, expect, it, vi } from "vitest";
import { nativeContinuityUiFixture } from "./nativeContinuityV3.fixture";
import { requestNativeContinuityV3 } from "./nativeContinuityV3";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.api(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { rewardDemo: true, rewardPortalEnabled: true } }));
beforeEach(() => mocks.api.mockReset());
it("checks private response scope and conserved pot, rejecting extras and money while held", async () => {
  const f = nativeContinuityUiFixture(); mocks.api.mockResolvedValue(f.data);
  expect((await requestNativeContinuityV3(f.record, f.bindingId)).reviewState).toBe("missing");
  expect(mocks.api.mock.calls[0][0]).toMatchObject({ cache: "no-store" });
  for (const patch of [{ chainId: 10143 }, { revision: 2 }, { bindingId: f.id(90) }, { privateKey: "not allowed" },
    { retainedWei: "0" }, { proposedWei: "1000000000000000000000", retainedWei: "9000000000000000000000" }]) {
    mocks.api.mockResolvedValueOnce({ ...f.data, ...patch }); await expect(requestNativeContinuityV3(f.record, f.bindingId)).rejects.toThrow();
  }
});
it("requires the exact persisted acknowledgement for a write", async () => {
  const f = nativeContinuityUiFixture(), change = { requestId: f.id(60), expectedReviewId: null, contextHash: f.data.contextHash,
    selection: { schema: "raceson-native-finale-continuity-v3" as const, athletes: [], clubs: [], classifications: [] }, decision: "held" as const };
  mocks.api.mockResolvedValueOnce(f.data); await expect(requestNativeContinuityV3(f.record, f.bindingId, change)).rejects.toThrow();
  const review = { id: change.requestId, previousReviewId: null, contextHash: change.contextHash, selection: change.selection,
    decision: change.decision, reviewedAt: "2026-09-10T05:00:00.000Z" };
  mocks.api.mockResolvedValueOnce({ ...f.data, reviewState: "held", review, recordedReview: review });
  expect((await requestNativeContinuityV3(f.record, f.bindingId, change)).review?.id).toBe(change.requestId);
});
