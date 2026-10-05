import { describe, expect, it } from "vitest";
import { clubFixture, clubId as id, clubAddress as a } from "./clubFixtures.test-helper";
import { decodeClubNomination, decodeClubRewardPage, decodeClubTreasuryCandidate, decodeClubTreasuryRequest, decodeRewardOwnedClubs } from "./clubTreasuries";
describe("private club treasury browser protocol", () => {
  it("copies valid candidates without treating them as approval or key-control proofs", () => {
    const f = clubFixture(), copy = decodeClubNomination(f.nomination); f.candidate.owners[0] = a(99);
    expect(copy.owners[0]).toBe(a(20)); expect(Object.keys(copy)).not.toContain("approved");
  });
  it("rejects injected metadata, accessors and invalid owners or deployment address tuples", () => {
    const f = clubFixture();
    for (const patch of [{ safeAddress: a(0) }, { owners: [a(1), a(21), a(22)] }, { owners: [a(20), a(20), a(22)] },
      { owners: [a(22), a(21), a(20)] }, { owners: [a(10), a(21), a(22)] }, { singletonAddress: a(10) }, { extra: true }])
      expect(() => decodeClubTreasuryCandidate({ ...f.candidate, ...patch })).toThrow();
    const getter = Object.defineProperty({ ...f.candidate }, "safeAddress", { get() { throw Error("getter ran"); }, enumerable: true });
    expect(() => decodeClubTreasuryCandidate(getter)).toThrow("invalid_response");
  });
  it("binds chain, immutable metadata and coherent history states", () => {
    const f = clubFixture(); expect(decodeClubTreasuryRequest(f.request, 31337)).toEqual(f.request);
    for (const patch of [{ status: "approved" }, { userId: id(8) }, { chainId: 10143 }, { requestedAt: "bad" }, { withdrawnAt: "2026-09-09T01:01:00Z" }, { status: "withdrawn" }])
      expect(() => decodeClubTreasuryRequest({ ...f.request, ...patch }, 31337)).toThrow();
  });
  it("validates 25-row ordered network-specific discovery/history pages", () => {
    const f = clubFixture(), items = Array.from({ length: 25 }, (_, i) => ({ ...f.request, requestId: id(i + 10) }));
    const decode = (v: unknown) => decodeClubTreasuryRequest(v, 31337), key = (v: typeof f.request) => v.requestId;
    expect(decodeClubRewardPage({ items, nextCursor: id(34) }, null, decode, key).items).toHaveLength(25);
    for (const page of [{ items, nextCursor: id(33) }, { items: [...items, items[0]], nextCursor: null }, { items: [items[1], items[0]], nextCursor: null }])
      expect(() => decodeClubRewardPage(page, null, decode, key)).toThrow();
    expect(decodeRewardOwnedClubs({ chainId: 31337, ...f.clubs }, 31337, null)).toEqual(f.clubs);
    expect(() => decodeRewardOwnedClubs({ chainId: 10143, ...f.clubs }, 31337, null)).toThrow();
    expect(() => decodeRewardOwnedClubs({ chainId: 31337, items: [{ ...f.clubs.items[0], isOwner: true }], nextCursor: null }, 31337, null)).toThrow();
  });
});
