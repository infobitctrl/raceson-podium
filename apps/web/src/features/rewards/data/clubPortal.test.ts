import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClubAwards, getClubClaims, getClubPaymentStatus } from "./clubPortal";
import { clubLedgerFixture } from "../model/clubLedgerFixtures.test-helper";
const c = vi.hoisted(() => ({ enabled: true, mode: "local", api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiRequest: c.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: { get rewardPortalEnabled() { return c.enabled; }, get rewardDemo() { return { mode: c.mode }; } } }));
beforeEach(() => { c.enabled = true; c.mode = "local"; c.api.mockReset(); });
describe("private club portal transport", () => {
  it("uses read-only no-store paths and validates exact network, club, claim and receipt", async () => {
    const f = clubLedgerFixture(); c.api.mockResolvedValueOnce(f.awards).mockResolvedValueOnce(f.claims).mockResolvedValueOnce(f.payment);
    expect(await getClubAwards(f.award.clubId)).toEqual(f.awards); expect(await getClubClaims()).toEqual(f.claims); expect(await getClubPaymentStatus(f.claim)).toEqual(f.payment);
    expect(c.api.mock.calls.map(([r]) => r)).toEqual([
      { path: `/v1/athlete/rewards/club-awards/${f.award.clubId}`, cache: "no-store" }, { path: "/v1/athlete/rewards/club-claims", cache: "no-store" },
      { path: `/v1/athlete/rewards/club-claims/${f.claim.intentId}/payment`, cache: "no-store" }]);
  });
  it("rejects disabled, malformed and cross-network requests before IO and a network change during IO", async () => {
    const f = clubLedgerFixture(); c.enabled = false;
    await expect(getClubClaims()).rejects.toThrow(); await expect(getClubAwards(f.award.clubId)).rejects.toThrow(); await expect(getClubPaymentStatus(f.claim)).rejects.toThrow();
    c.enabled = true; await expect(getClubAwards("bad")).rejects.toThrow(); await expect(getClubClaims("bad")).rejects.toThrow(); c.mode = "testnet";
    await expect(getClubPaymentStatus(f.claim)).rejects.toThrow(); expect(c.api).not.toHaveBeenCalled();
    c.mode = "local"; c.api.mockImplementation(async () => { c.mode = "testnet"; return f.claims; }); await expect(getClubClaims()).rejects.toThrow();
  });
  it("does not trust another club's response or a malformed confirmation and snapshots history before waiting", async () => {
    const f = clubLedgerFixture(); c.api.mockResolvedValue({ ...f.awards, items: [{ ...f.award, clubId: f.award.campaignId }] });
    await expect(getClubAwards(f.award.clubId)).rejects.toThrow(); c.api.mockResolvedValue({ ...f.payment, receipt: { ...f.payment.receipt, safeReceivedLogIndex: 2 } });
    await expect(getClubPaymentStatus(f.claim)).rejects.toThrow();
    c.api.mockImplementation(async () => { f.claim.amountWei = "1"; return clubLedgerFixture().payment; });
    expect((await getClubPaymentStatus(f.claim)).claim.amountWei).toBe("75000000000000000000");
  });
});
