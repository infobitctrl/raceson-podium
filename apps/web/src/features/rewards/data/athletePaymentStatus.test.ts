import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAthletePaymentStatus } from "./athletePaymentStatus";
import { paymentFixture } from "../model/paymentFixtures.test-helper";
const calls = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: calls.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return calls.enabled; },
  rewardDemo: { get mode() { return calls.mode; } } } }));
beforeEach(() => { calls.api.mockReset(); calls.enabled = true; calls.mode = "local"; });
describe("athlete payment status API client", () => {
  it("makes only an authenticated no-store GET at the exact selected claim path", async () => {
    const f = paymentFixture(); calls.api.mockResolvedValue(f.payment);
    expect(await getAthletePaymentStatus(f.history)).toEqual(f.payment);
    expect(calls.api).toHaveBeenCalledExactlyOnceWith({ path: `/v1/athlete/rewards/claims/${f.history.intentId}/payment`, cache: "no-store" });
  });
  it("denies disabled, malformed or foreign-network scope before IO, and response/configuration changes after IO", async () => {
    const f = paymentFixture(); calls.enabled = false;
    await expect(getAthletePaymentStatus(f.history)).rejects.toThrow(); expect(calls.api).not.toHaveBeenCalled();
    calls.enabled = true; calls.mode = "testnet";
    await expect(getAthletePaymentStatus(f.history)).rejects.toThrow(); expect(calls.api).not.toHaveBeenCalled();
    calls.mode = "local";
    await expect(getAthletePaymentStatus({ ...f.history, intentId: "../operator" })).rejects.toThrow(); expect(calls.api).not.toHaveBeenCalled();
    calls.api.mockResolvedValue({ ...f.payment, chainId: 143 }); await expect(getAthletePaymentStatus(f.history)).rejects.toThrow();
    calls.api.mockImplementation(async () => { calls.mode = "testnet"; return f.payment; });
    await expect(getAthletePaymentStatus(f.history)).rejects.toThrow();
  });
  it("captures immutable scope before async IO and does not reuse the caller's changed object", async () => {
    const f = paymentFixture(), history = { ...f.history }; let finish!: (value: unknown) => void;
    calls.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = getAthletePaymentStatus(history); history.amountWei = "7"; history.intentId = "changed"; finish(f.payment);
    expect(await pending).toEqual(f.payment);
  });
});
