import { describe, expect, it } from "vitest";
import { decodeAllocations, decodeWalletChallenge, decodeWalletProof, formatTestMon, rewardErrorKey } from "./athleteRewards";

export const award = (overrides = {}) => ({
  entitlementId: "00000000-0000-4000-8000-000000000001", campaignId: "00000000-0000-4000-8000-000000000002",
  athleteProfileId: "00000000-0000-4000-8000-000000000003", pot: "race", scopeKey: "00000000-0000-4000-8000-000000000004",
  chainId: 31337, environment: "local_simulation", amountWei: "1000000000000000001", identityChanged: false, ageStatus: "unverified_adult", ...overrides,
});

describe("private athlete rewards presentation contract", () => {
  it("preserves exact positive uint256 amounts without floating-point rounding", () => {
    expect(formatTestMon("1", "en")).toBe("0.000000000000000001");
    expect(formatTestMon("1000000000000000001", "hr")).toBe("1,000000000000000001");
    expect(formatTestMon("1234000000000000000000", "en")).toBe("1,234");
    expect(decodeAllocations({ items: [award()], nextCursor: null }).items[0].amountWei).toBe("1000000000000000001");
    for (const invalid of ["0", "-1", "1e18", "01", (2n ** 256n).toString()]) expect(() => formatTestMon(invalid, "en")).toThrow();
  });
  it("fails closed on unexpected privacy fields, networks, scopes and readiness assertions", () => {
    for (const fields of [{ email: "private@example.invalid" }, { chainId: 143 }, { ageStatus: "adult_verified" },
      { amountWei: 1 }, { scopeKey: "/attacker" }, { pot: "league" }, { environment: "testnet_pilot" }, { identityChanged: "false" }]) {
      expect(() => decodeAllocations({ items: [award(fields)], nextCursor: null })).toThrow();
    }
    expect(decodeAllocations({ items: [award({ pot: "league", scopeKey: "rounds-1-5", ageStatus: "minor", identityChanged: true })], nextCursor: null }).items[0])
      .toMatchObject({ ageStatus: "minor", identityChanged: true, amountWei: "1000000000000000001" });
  });
  it("requires bounded, ordered pages and an exact cursor", () => {
    expect(() => decodeAllocations({ items: [award(), award()], nextCursor: null })).toThrow();
    expect(() => decodeAllocations({ items: [award()], nextCursor: award().entitlementId })).toThrow();
    expect(() => decodeAllocations({ items: [award()], nextCursor: null }, award().entitlementId)).toThrow();
    const items = Array.from({ length: 50 }, (_, index) => award({ entitlementId: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}` }));
    expect(decodeAllocations({ items, nextCursor: items[49].entitlementId }).items).toHaveLength(50);
  });
  it("never accepts a verification response for another address, chain or proof kind", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const challenge = decodeWalletChallenge({ challengeId: award().entitlementId, address, chainId: 31337,
      message: "validated separately before signing", expiresAt: "2026-09-08T12:10:00Z", alreadyVerified: false }, address);
    const proof = { proofId: award().campaignId, address, chainId: 31337, verifiedAt: "2026-09-08T12:00:01Z", proofKind: "eip191_address_control" };
    expect(decodeWalletProof(proof, challenge).proofKind).toBe("eip191_address_control");
    for (const fields of [{ address: "0x2222222222222222222222222222222222222222" }, { chainId: 10143 }, { proofKind: "payment_ready" },
      { verifiedAt: challenge.expiresAt }, { verifiedAt: "2026-09-08T11:59:59Z" }]) expect(() => decodeWalletProof({ ...proof, ...fields }, challenge)).toThrow();
  });
  it("maps only stable error codes, never raw wallet or server messages", () => {
    expect(rewardErrorKey({ code: 4001, message: "secret material" })).toBe("rewards.error.rejected");
    expect(rewardErrorKey({ status: 401 })).toBe("rewards.error.signIn");
    expect(rewardErrorKey(new Error("private database details"))).toBe("rewards.error.generic");
  });
});
