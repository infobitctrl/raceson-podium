import { beforeEach, expect, it, vi } from "vitest";
import { decodeLeaguePolicyViewV3 } from "@raceson/domain/rewards/league-policy-view-v3";
import { requestLeaguePolicyV3 } from "./leaguePolicyV3";
import { leaguePolicyUiFixture } from "./leaguePolicyV3.fixture";
const mocks = vi.hoisted(() => ({ api: vi.fn(), env: { rewardDemo: true, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.api(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.api.mockReset(); mocks.env.rewardDemo = true; });
it("accepts selected seven-category proposals and source holds; enforces private scope", async () => {
  const f = leaguePolicyUiFixture(); mocks.api.mockResolvedValue(f.data);
  expect((await requestLeaguePolicyV3(f.record)).proposal?.athleteTables).toHaveLength(7);
  expect(mocks.api.mock.calls[0][0]).toMatchObject({ cache: "no-store", path: `/v1/organizer/rewards/drafts/${f.record.draftId}/league-policy` });
  for (const patch of [{ draftId: f.id(70) }, { organizationId: f.id(71) }, { chainId: 10143 }, { revision: 2 }, { wallet: "forbidden" },
    { payableWei: "1" }, { finalPublished: true }, { proposalHash: null }, { reviewState: "held" }]) {
    mocks.api.mockResolvedValueOnce({ ...f.data, ...patch }); await expect(requestLeaguePolicyV3(f.record)).rejects.toThrow();
  }
  expect(decodeLeaguePolicyViewV3(leaguePolicyUiFixture("four_rounds").data).proposal?.state).toBe("held");
  expect(decodeLeaguePolicyViewV3(leaguePolicyUiFixture("distance_hold").data).proposal?.participation.hold).toBe("missing_distance");
  mocks.env.rewardDemo = false; await expect(requestLeaguePolicyV3(f.record)).rejects.toThrow();
});
it("rejects malformed nested projections, unrelated labels, getter and sparse payloads", () => {
  for (const mutate of [
    (v: ReturnType<typeof leaguePolicyUiFixture>["data"]) => { v.proposal!.athleteTables[0].rows[0].points++; },
    (v: ReturnType<typeof leaguePolicyUiFixture>["data"]) => { v.proposal!.clubTables[0].rows[0].contributions[0].counted = !v.proposal!.clubTables[0].rows[0].contributions[0].counted; },
    (v: ReturnType<typeof leaguePolicyUiFixture>["data"]) => { v.proposal!.participation.totalMetres = "1"; },
    (v: ReturnType<typeof leaguePolicyUiFixture>["data"]) => { v.labels.athletes[0].id = v.draftId; },
    (v: ReturnType<typeof leaguePolicyUiFixture>["data"]) => { delete v.categories[0]; },
  ]) { const v = leaguePolicyUiFixture().data; mutate(v); expect(() => decodeLeaguePolicyViewV3(v)).toThrow(); }
  let invoked = false; const v = leaguePolicyUiFixture().data; Object.defineProperty(v, "proposal", { enumerable: true, get() { invoked = true; return null; } });
  expect(() => decodeLeaguePolicyViewV3(v)).toThrow(); expect(invoked).toBe(false);
});
it("requires exact acknowledgement while allowing an older successful retry to observe a later hold", async () => {
  const f = leaguePolicyUiFixture(), r = f.data.review!, change = { requestId: r.id, expectedReviewId: r.previousReviewId, contextHash: r.contextHash, policy: r.policy, decision: r.decision };
  mocks.api.mockResolvedValueOnce(f.data); await expect(requestLeaguePolicyV3(f.record, change)).rejects.toThrow();
  const held = { ...f.missing, reviewState: "held", review: { ...r, id: f.id(91), previousReviewId: r.id, decision: "held" }, recordedReview: r };
  mocks.api.mockResolvedValueOnce(held); expect((await requestLeaguePolicyV3(f.record, change)).review?.decision).toBe("held");
  expect(mocks.api.mock.calls[1][0].body).toEqual(change);
  mocks.api.mockResolvedValueOnce(held); await expect(requestLeaguePolicyV3(f.record)).rejects.toThrow();
});
