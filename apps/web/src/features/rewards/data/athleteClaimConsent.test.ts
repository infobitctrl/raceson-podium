import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOwnAthleteClaims } from "./athleteClaims";
import { getAthleteClaimReview, submitAthleteClaimConsent } from "./athleteClaimConsent";
import { decodeAthleteClaimReview } from "../model/athleteClaimConsent";
import { claimFixture, claimId } from "../model/claimFixtures.test-helper";
const calls = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: calls.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return calls.enabled; },
  rewardDemo: { get mode() { return calls.mode; } } } }));
beforeEach(() => { calls.api.mockReset(); calls.enabled = true; calls.mode = "local"; });
describe("athlete consent API client", () => {
  it("uses exact private routes and permits only signature and retry key in the POST", async () => {
    const f = claimFixture(); calls.api.mockResolvedValueOnce({ items: [f.history], nextCursor: null });
    expect((await getOwnAthleteClaims()).items[0]).toEqual(f.history);
    expect(calls.api.mock.calls[0][0]).toEqual({ path: "/v1/athlete/rewards/claims", cache: "no-store" });
    calls.api.mockResolvedValueOnce(f.raw); const review = await getAthleteClaimReview(f.history);
    calls.api.mockResolvedValueOnce(f.receipt);
    const signature = `0x${"ab".repeat(65)}`, key = claimId(8);
    expect(await submitAthleteClaimConsent(review, signature, key)).toEqual(f.receipt);
    expect(calls.api.mock.lastCall?.[0]).toEqual({ path: `/v1/athlete/rewards/claims/${f.history.intentId}/consent`,
      method: "POST", cache: "no-store", body: { signature, idempotencyKey: key } });
  });
  it("fails closed on disabled features, mismatched demo networks, invalid paths and extra response authority", async () => {
    const f = claimFixture(); calls.enabled = false;
    await expect(getOwnAthleteClaims()).rejects.toThrow(); expect(calls.api).not.toHaveBeenCalled();
    calls.enabled = true; calls.mode = "testnet";
    await expect(getAthleteClaimReview(f.history)).rejects.toThrow(); expect(calls.api).not.toHaveBeenCalled();
    calls.mode = "local";
    await expect(getOwnAthleteClaims("../operator")).rejects.toThrow(); expect(calls.api).not.toHaveBeenCalled();
    calls.api.mockResolvedValue({ ...f.raw, operatorAuthorization: "private" });
    await expect(getAthleteClaimReview(f.history)).rejects.toThrow();
    calls.api.mockResolvedValue({ items: [{ ...f.history, chainId: 10143 }], nextCursor: null });
    await expect(getOwnAthleteClaims()).rejects.toThrow();
  });
  it("copies scope before async reads and confirmations, ignoring mutations of the caller's object", async () => {
    const f = claimFixture(), history = { ...f.history };
    let finish!: (value: unknown) => void; calls.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const read = getAthleteClaimReview(history); history.intentId = claimId(9); finish(f.raw);
    expect((await read).intentId).toBe(f.history.intentId);
    const review = decodeAthleteClaimReview(f.raw, f.history);
    const post = submitAthleteClaimConsent(review, `0x${"ab".repeat(65)}`, claimId(8));
    review.intentId = claimId(10); review.expiresAt = "9"; finish(f.receipt);
    expect(await post).toEqual(f.receipt);
  });
});
