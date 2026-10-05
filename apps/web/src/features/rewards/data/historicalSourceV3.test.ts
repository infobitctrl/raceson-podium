import { beforeEach, expect, it, vi } from "vitest";
import { loadHistoricalReviewContext, requestHistoricalSourceV3 } from "./historicalSourceV3";
import { historicalFixture, syntheticPilotReviewFixture } from "./historicalSourceV3.fixture";
const mocks = vi.hoisted(() => ({ request: vi.fn(), env: { rewardDemo: {chainId:31337} as {chainId:number}|false, rewardPortalEnabled: true } }));
vi.mock("@/lib/api", () => ({ apiRequest: (...args: unknown[]) => mocks.request(...args) }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mocks.env }));
beforeEach(() => { mocks.request.mockReset(); mocks.env.rewardDemo = {chainId:31337}; });
it("preserves explicit synthetic provenance and refuses historical evidence substituted into the pilot", async () => {
  const f = syntheticPilotReviewFixture(); mocks.request.mockResolvedValue(f.wire);
  expect(await requestHistoricalSourceV3(f.context)).toEqual(f.data);
  expect(f.data.source.kind).toBe("synthetic_rehearsal"); expect(f.data.preview.proposedWei).toBe(0n);
  f.wire.source.rounds[0].evidence.kind = "historical_final";
  await expect(requestHistoricalSourceV3(f.context)).rejects.toThrow();
});
it("recomputes exact historical amounts and sends a private no-store read", async () => {
  const f = historicalFixture(); mocks.request.mockResolvedValue(f.wire);
  expect(await requestHistoricalSourceV3(f.context)).toEqual(f.data);
  expect(mocks.request).toHaveBeenCalledWith({ path: `/v1/organizer/rewards/drafts/${f.context.record.draftId}/historical-source`, cache: "no-store" });
});
it("checks the exact recorded acknowledgement without treating it as payout", async () => {
  const f = historicalFixture("confirmed_final"), d = f.data.decisions[0]; mocks.request.mockResolvedValue(f.wire);
  const request = { slot: 1, requestId: d.id, expectedReviewId: null, contextHash: f.data.contextHash, decision: "confirmed_final" as const };
  expect((await requestHistoricalSourceV3(f.context, request)).preview.payableWei).toBe(0n);
  expect(mocks.request.mock.calls[0][0]).toMatchObject({ method: "POST", body: request });
  await expect(requestHistoricalSourceV3(f.context, { ...request, decision: "held" })).rejects.toThrow();
});
it("rejects mismatched scope/amounts/decisions/private extras and production mode", async () => {
  type Wire = ReturnType<typeof historicalFixture>["wire"];
  for (const change of [(v: Wire) => v.preview.proposedWei = "1", (v: Wire) => v.record.chainId = 10143,
    (v: Wire) => v.source.rounds[0].evidence.held = false, (v: Wire) => v.privateData = "secret",
    (v: Wire) => v.source.results = [], (v: Wire) => v.record.revision = 2]) {
    const f = historicalFixture(); change(f.wire); mocks.request.mockResolvedValue(f.wire);
    await expect(requestHistoricalSourceV3(f.context)).rejects.toThrow();
  }
  mocks.env.rewardDemo = false; mocks.request.mockClear();
  await expect(requestHistoricalSourceV3(historicalFixture().context)).rejects.toThrow(); expect(mocks.request).not.toHaveBeenCalled();
});

it("bootstraps a verified context and rejects another draft or chain", async () => {
 const f=historicalFixture();mocks.request.mockResolvedValue(f.wire);
 expect(await loadHistoricalReviewContext(f.context.record.draftId,1)).toEqual(f.context);
 await expect(loadHistoricalReviewContext("73000000-0000-4000-8000-000000000099",1)).rejects.toThrow();
 mocks.env.rewardDemo={chainId:10143};
 await expect(loadHistoricalReviewContext(f.context.record.draftId,1)).rejects.toThrow();
 expect(mocks.request.mock.calls.every(([request])=>!request.method)).toBe(true);
});
