import { beforeEach, describe, expect, it, vi } from "vitest";
import { clubFixture, clubId as id, clubAddress as a } from "../model/clubFixtures.test-helper";
import { getRewardOwnedClubs, getClubTreasuryHistory, submitClubTreasury, readClubTreasury, withdrawClubTreasury } from "./clubTreasuries";
const c = vi.hoisted(() => ({ api: vi.fn(), enabled: true, mode: "local" }));
vi.mock("@/lib/api", () => ({ apiRequest: c.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, rewardDemo: { get mode() { return c.mode; } } } }));
beforeEach(() => { c.api.mockReset(); c.enabled = true; c.mode = "local"; });
describe("demo-only club treasury transport", () => {
  it("loads only explicit no-store pages and details", async () => {
    const f = clubFixture(); c.api.mockResolvedValueOnce({ chainId: 31337, ...f.clubs }).mockResolvedValueOnce(f.history).mockResolvedValueOnce(f.request);
    await getRewardOwnedClubs(); await getClubTreasuryHistory(); await readClubTreasury(id(4));
    expect(c.api.mock.calls.map(([v]) => v)).toEqual([
      { path: "/v1/athlete/rewards/owned-clubs", cache: "no-store" }, { path: "/v1/athlete/rewards/club-treasury-requests", cache: "no-store" },
      { path: `/v1/athlete/rewards/club-treasury-requests/${id(4)}`, cache: "no-store" }]);
  });
  it("freezes nominations before IO and binds replies to the exact candidate", async () => {
    const f = clubFixture(), original = structuredClone(f.nomination), result = structuredClone(f.request);
    c.api.mockImplementation(async () => { f.nomination.owners[0] = a(99); return result; });
    expect(await submitClubTreasury(f.nomination)).toEqual(result); expect(c.api.mock.calls[0][0].body).toEqual(original);
    c.api.mockResolvedValue({ ...result, clubId: id(99) }); await expect(submitClubTreasury(original)).rejects.toThrow();
  });
  it("withdraws the exact original request and refuses immutable metadata substitution", async () => {
    const f = clubFixture(), withdrawn = { ...f.request, status: "withdrawn", withdrawnAt: "2026-09-09T01:01:00Z" };
    c.api.mockResolvedValue(withdrawn); await withdrawClubTreasury(f.request);
    expect(c.api.mock.calls[0][0]).toEqual({ path: `/v1/athlete/rewards/club-treasury-requests/${id(4)}/withdraw`, method: "POST", body: {}, cache: "no-store" });
    for (const patch of [{ requestId: id(9) }, { requestedAt: "2026-09-09T00:59:00Z" }, { candidate: { ...f.candidate, safeAddress: a(9) } }]) {
      c.api.mockResolvedValue({ ...withdrawn, ...patch }); await expect(withdrawClubTreasury(f.request)).rejects.toThrow();
    }
  });
  it("rejects disabled/bad scopes and configuration drift without wallet or chain calls", async () => {
    c.enabled = false; await expect(getRewardOwnedClubs()).rejects.toThrow(); c.enabled = true;
    await expect(getClubTreasuryHistory("bad")).rejects.toThrow(); await expect(readClubTreasury("../secret")).rejects.toThrow(); expect(c.api).not.toHaveBeenCalled();
    const f = clubFixture(); c.api.mockImplementation(async () => { c.mode = "testnet"; return f.history; }); await expect(getClubTreasuryHistory()).rejects.toThrow();
  });
});
