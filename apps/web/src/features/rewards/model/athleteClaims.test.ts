import { describe, expect, it } from "vitest";
import { hashTypedData } from "viem";
import { decodeAthleteRewardClaim, decodeAthleteRewardClaims } from "./athleteClaims";
import { athleteConsentSigningJson, decodeAthleteClaimReview, decodeAthleteConsentReceipt } from "./athleteClaimConsent";
import { claimFixture, claimId } from "./claimFixtures.test-helper";

describe("private athlete claim browser contracts", () => {
  it("preserves exact amounts, network scope and checksum addresses and reconstructs the contract digest", () => {
    for (const chain of [31337, 10143] as const) {
      const f = claimFixture(chain), history = decodeAthleteRewardClaims({ items: [f.history], nextCursor: null }).items[0];
      const review = decodeAthleteClaimReview(f.raw, history);
      expect(review.state).toBe("awaiting_consent"); if (!review.signing) throw new Error("missing signing");
      expect(review.signing).not.toBe(f.raw.signing);
      expect(hashTypedData(review.signing)).toBe(hashTypedData(f.signing));
      const json = JSON.parse(athleteConsentSigningJson(review.signing));
      expect(json.message.amount).toBe("1000000000000000001"); expect(json.types.EIP712Domain).toHaveLength(4);
      expect(decodeAthleteConsentReceipt(f.receipt, review)).toEqual(f.receipt);
    }
  });
  it("rejects private fields, noncanonical integers, invalid networks, timestamps and pagination", () => {
    const { history } = claimFixture();
    for (const patch of [{ signature: "secret" }, { amountWei: 1 }, { amountWei: "01" }, { amountWei: "0" }, { amountWei: String(2n ** 256n) },
      { chainId: 143 }, { pot: "club" }, { expiresAt: history.issuedAt }, { issuedAt: "1", expiresAt: "86402" },
      { preparedAt: "not a date" }, { operatorApprovalRecordedAt: new Date().toISOString() }, { scopeKey: "unreviewed" }])
      expect(() => decodeAthleteRewardClaim({ ...history, ...patch })).toThrow();
    expect(() => decodeAthleteRewardClaims({ items: [history, history], nextCursor: null })).toThrow();
    expect(() => decodeAthleteRewardClaims({ items: [history], nextCursor: history.intentId })).toThrow();
    expect(() => decodeAthleteRewardClaims({ items: [history], nextCursor: null }, history.intentId)).toThrow();
    const items = Array.from({ length: 50 }, (_, i) => ({ ...history, intentId: claimId(i + 10) }));
    expect(decodeAthleteRewardClaims({ items, nextCursor: items[49].intentId }).nextCursor).toBe(items[49].intentId);
  });
  it("rejects all changes to reviewed scope, domain, recipient, amount, types, lifetime and observation", () => {
    const f = claimFixture();
    const mutations = [
      (d: typeof f.raw) => { d.amountWei = "2"; }, (d: typeof f.raw) => { d.intentId = claimId(7); },
      (d: typeof f.raw) => { d.signing.domain.chainId = 143; }, (d: typeof f.raw) => { d.signing.domain.version = "1"; },
      (d: typeof f.raw) => { d.signing.domain.name = "Spending approval"; }, (d: typeof f.raw) => { d.signing.primaryType = "ClaimAuthorization"; },
      (d: typeof f.raw) => { d.signing.message.amount = 1; }, (d: typeof f.raw) => { d.signing.message.pot = 1; },
      (d: typeof f.raw) => { d.signing.message.recipient = `0x${"aa".repeat(20)}`; },
      (d: typeof f.raw) => { d.signing.message.nonce = "02"; }, (d: typeof f.raw) => { d.signing.message.approve = true; },
      (d: typeof f.raw) => { d.signing.message.allocationDigest = `0x${"00".repeat(32)}`; },
      (d: typeof f.raw) => { d.signing.types.ReceiveReward.reverse(); }, (d: typeof f.raw) => { d.signing.types.EIP712Domain = []; },
      (d: typeof f.raw) => { d.observation.timestamp = f.history.expiresAt; },
      (d: typeof f.raw) => { d.observation.timestamp = String(BigInt(f.history.issuedAt) - 1n); },
    ];
    for (const mutate of mutations) { const d = structuredClone(f.raw); mutate(d); expect(() => decodeAthleteClaimReview(d, f.history)).toThrow(); }
  });
  it("recorded history has no signing payload, cannot regress and is never an operator receipt", () => {
    const f = claimFixture(), result = decodeAthleteClaimReview(f.recorded, f.history);
    expect(result.state).toBe("consent_recorded"); expect(result.signing).toBeNull();
    expect(() => decodeAthleteClaimReview({ ...f.recorded, signing: f.raw.signing }, f.history)).toThrow();
    expect(() => decodeAthleteClaimReview(f.raw, { ...f.history, recipientConsentRecordedAt: f.receipt.recordedAt })).toThrow();
    expect(() => decodeAthleteConsentReceipt({ ...f.receipt, role: "operator" }, result)).toThrow();
    expect(() => decodeAthleteConsentReceipt({ ...f.receipt, transactionHash: "fake payment" }, result)).toThrow();
  });
});
