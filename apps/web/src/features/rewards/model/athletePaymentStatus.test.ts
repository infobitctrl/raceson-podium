import { describe, expect, it } from "vitest";
import { decodeAthletePaymentStatus } from "./athletePaymentStatus";
import { paymentFixture } from "./paymentFixtures.test-helper";

describe("athlete payment status browser model", () => {
  it.each([31337, 10143] as const)("retains exact amounts and confirmed receipts on %s even if cached history predates consent", chain => {
    const f = paymentFixture("confirmed", chain);
    expect(f.history.recipientConsentRecordedAt).toBeNull();
    expect(decodeAthletePaymentStatus(f.payment, f.history)).toEqual(f.payment);
    const result = decodeAthletePaymentStatus(f.payment, f.history);
    expect(result).not.toBe(f.payment); expect(result.receipt).not.toBe(f.payment.receipt);
    expect(result.receipt?.finalizedBlock).not.toBe(f.payment.receipt?.finalizedBlock);
  });
  it("accepts only null receipts in non-confirmed stages and never infers payment from a past signature window", () => {
    for (const status of ["no_confirmation", "queued", "processing", "submission_unconfirmed"] as const) {
      const f = paymentFixture(status); expect(decodeAthletePaymentStatus(f.payment, f.history).receipt).toBeNull();
    }
    const f = paymentFixture(); f.history.issuedAt = "1"; f.history.expiresAt = "20";
    f.payment.receipt!.blockTimestamp = "10"; f.payment.receipt!.finalizedBlock.timestamp = "10";
    expect(decodeAthletePaymentStatus(f.payment, f.history).status).toBe("confirmed");
  });
  it("rejects foreign scope, statuses, private fields, numeric amounts and receipt/status disagreements", () => {
    const f = paymentFixture();
    for (const change of [{ intentId: "bad" }, { programmeId: f.history.intentId }, { campaignId: f.history.intentId },
      { entitlementId: f.history.intentId }, { scopeKey: "rounds-1-5" }, { pot: "league" }, { chainId: 143 },
      { amountWei: 1 }, { amountWei: "1000000000000000000" }, { recipientAddress: `0x${"ff".repeat(20)}` },
      { status: "unpaid" }, { status: "queued" }, { receipt: null }, { operatorSignature: "private" }, { balance: "1" }])
      expect(() => decodeAthletePaymentStatus({ ...f.payment, ...change }, f.history)).toThrow();
  });
  it("rejects malformed or inconsistent block evidence, lossy integers, invalid clocks and extra receipt fields", () => {
    const f = paymentFixture();
    for (const change of [{ transactionHash: "bad" }, { transactionHash: `0x${"00".repeat(32)}` }, { contractAddress: "bad" },
      { blockNumber: 100 }, { blockNumber: "0" }, { blockNumber: "101" }, { blockHash: `0x${"cc".repeat(32)}` },
      { blockTimestamp: f.history.expiresAt }, { blockTimestamp: "0" }, { logIndex: -1 }, { logIndex: Number.MAX_SAFE_INTEGER + 1 },
      { recordedAt: "invalid" }, { recordedAt: "2020-01-01T00:00:00Z" }, { observedAt: "2020-01-01T00:00:00Z" },
      { signature: "private" }, { explorer: "https://attacker.invalid" }])
      expect(() => decodeAthletePaymentStatus({ ...f.payment, receipt: { ...f.payment.receipt, ...change } }, f.history)).toThrow();
    for (const change of [{ number: "99" }, { hash: `0x${"cc".repeat(32)}` }, { timestamp: "1" }, { timestamp: "01" }, { signature: "private" }])
      expect(() => decodeAthletePaymentStatus({ ...f.payment, receipt: { ...f.payment.receipt, finalizedBlock: { ...f.payment.receipt?.finalizedBlock, ...change } } }, f.history)).toThrow();
  });
});
