import { beforeEach, expect, it, vi } from "vitest";
import { getAthletePaymentStatusV3 } from "./athletePaymentStatusV3";
import { decodeAthletePaymentStatusV3 } from "../model/athletePaymentStatusV3";
import { consentV3Fixture } from "../model/athleteConsentV3Fixtures.test-helper";
const mock = vi.hoisted(() => ({ api: vi.fn(), env: { rewardPortalEnabled: true, rewardDemo: { mode: "local" } } }));
vi.mock("@/lib/api", () => ({ apiRequest: mock.api }));
vi.mock("@/lib/public-env", () => ({ publicEnv: mock.env }));
beforeEach(() => { mock.api.mockReset(); mock.env.rewardDemo.mode = "local"; });
it("reads only the exact private V3 payment endpoint and checks environment again after IO", async () => {
  const f = consentV3Fixture(); mock.api.mockResolvedValue(f.payment);
  expect(await getAthletePaymentStatusV3(f.claim)).toEqual(f.payment);
  expect(mock.api.mock.calls[0][0]).toEqual({ path: `/v1/athlete/rewards/uploads/${f.claim.uploadId}/destinations/${f.claim.destinationId}/awards/${f.claim.entitlementId}/claims/${f.claim.claimId}/payment`, cache: "no-store" });
  mock.api.mockImplementationOnce(async () => { mock.env.rewardDemo.mode = "testnet"; return f.payment; });
  await expect(getAthletePaymentStatusV3(f.claim)).rejects.toThrow();
});
it("requires an exact scoped confirmed receipt, not consent, a hash alone or private extras", () => {
  const f = consentV3Fixture(), paid = { ...f.payment, state: "confirmed", confirmed: true, paymentId: f.claim.claimId,
    transactionHash: `0x${"a".repeat(64)}`, blockNumber: "400", blockHash: `0x${"b".repeat(64)}` };
  expect(decodeAthletePaymentStatusV3(paid, f.claim).confirmed).toBe(true);
  for (const patch of [{ confirmed: false }, { state: "submitted" }, { amountWei: "1" }, { chainId: 10143 }, { blockNumber: "0" },
    { blockHash: null }, { transactionHash: null }, { recipientAddress: `0x${"c".repeat(40)}` }, { claimId: f.claim.uploadId }, { signature: "private" }])
    expect(() => decodeAthletePaymentStatusV3({ ...paid, ...patch }, f.claim)).toThrow();
  expect(() => decodeAthletePaymentStatusV3({ ...f.payment, transactionHash: paid.transactionHash }, f.claim)).toThrow();
});
