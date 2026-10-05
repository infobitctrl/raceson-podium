import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDestination, decodeDestinations } from "./athleteDestinations";
import { rewardErrorKey } from "./athleteRewards";
import { getOwnRewardDestinations, submitRewardDestination, withdrawRewardDestination } from "../data/athleteDestinations";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: api }));
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = { requestId: id(1), athleteProfileId: id(2), address: `0x${"ab".repeat(20)}`, chainId: 31337,
  requestedAt: "2026-09-08T08:00:00Z", withdrawnAt: null, status: "pending_review" };
beforeEach(() => api.mockReset());
describe("destination browser boundary", () => {
  it("accepts only explicit pending/held/withdrawn choices without hidden private or approval fields", () => {
    expect(decodeDestination(request).status).toBe("pending_review");
    for (const patch of [{ status: "active" }, { chainId: 143 }, { proofId: id(9) }, { amountWei: "1" }, { address: "0x0" },
      { status: "withdrawn" }, { status: "withdrawn", withdrawnAt: "2026-09-01T08:00:00Z" }])
      expect(() => decodeDestination({ ...request, ...patch })).toThrow();
  });
  it("validates the complete bounded cursor sequence", () => {
    const items = Array.from({ length: 50 }, (_, n) => ({ ...request, requestId: id(100 + n) }));
    expect(decodeDestinations({ items, nextCursor: id(149) }, id(99)).items).toHaveLength(50);
    for (const value of [{ items, nextCursor: id(148) }, { items: [request, request], nextCursor: null },
      { items: [request], nextCursor: id(1) }, { items: [...items, request], nextCursor: null }])
      expect(() => decodeDestinations(value)).toThrow();
  });
  it("lists history with no-store and no client identity parameters", async () => {
    api.mockResolvedValue({ items: [], nextCursor: null }); await getOwnRewardDestinations(id(9));
    expect(api).toHaveBeenCalledWith({ path: `/v1/athlete/rewards/destination-requests?after=${id(9)}`, cache: "no-store" });
  });
  it("submits a proof reference/profile/key only and rejects a different returned destination", async () => {
    const challenge = { challengeId: id(3), address: request.address as `0x${string}`, chainId: 31337 as const, message: "fixture", expiresAt: "2026-09-08T08:10:00Z", alreadyVerified: true };
    api.mockResolvedValue(request);
    await submitRewardDestination(challenge, id(2), "same-retry-key");
    expect(api).toHaveBeenCalledWith({ path: "/v1/athlete/rewards/destination-requests", method: "POST", cache: "no-store",
      body: { challengeId: id(3), athleteProfileId: id(2), idempotencyKey: "same-retry-key" } });
    for (const patch of [{ athleteProfileId: id(9) }, { address: `0x${"cd".repeat(20)}` }, { chainId: 10143 }]) {
      api.mockResolvedValue({ ...request, ...patch }); await expect(submitRewardDestination(challenge, id(2), "same-retry-key")).rejects.toThrow();
    }
  });
  it("never reports a withdrawal from a pending or different request response", async () => {
    for (const result of [request, { ...request, requestId: id(9), status: "withdrawn", withdrawnAt: "2026-09-08T08:01:00Z" }]) {
      api.mockResolvedValue(result); await expect(withdrawRewardDestination(id(1))).rejects.toThrow();
    }
    api.mockResolvedValue({ ...request, status: "withdrawn", withdrawnAt: "2026-09-08T08:01:00Z" });
    expect((await withdrawRewardDestination(id(1))).status).toBe("withdrawn");
  });
  it("maps bounded errors without showing raw server messages", () => {
    expect(rewardErrorKey({ code: "reward_destination_withdraw_first", message: "secret" })).toBe("rewards.destination.error.withdrawFirst");
    expect(rewardErrorKey({ code: "reward_destination_profile_required" })).toBe("rewards.destination.error.profile");
    expect(rewardErrorKey({ code: "reward_destination_not_found", status: 404 })).toBe("rewards.destination.error.notFound");
  });
});
