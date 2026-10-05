import { rewardId as id } from "./reward-calculation.mjs";

/** Explicitly synthetic projections, never a seed/import of sporting results. */
export function distributionFixture() {
  const mon = 10n ** 18n, wei = n => String(BigInt(n) * mon);
  const identity = { userId: id(4), sessionId: id(5) }, scope = { programmeId: id(10), chainId: 31337 };
  const reservedAt = "2026-09-08T12:00:00Z";
  const campaigns = { ...scope, budgetWei: wei(10000), items: [1, 2, 3, 4, 5, 6].map(n => ({
    campaignId: id(40 + n), pot: n === 6 ? "league" : "race", scopeKey: n === 6 ? "rounds-1-5" : id(100 + n),
    roundNumber: n === 6 ? null : n, raceName: n === 6 ? null : `Synthetic round ${n}`, budgetWei: wei(n === 6 ? 4000 : 1200),
    allocation: n !== 1 ? null : { allocationId: id(80), reservedAt, allocatedWei: wei(70), unallocatedWei: wei(1130), awardCount: 1 },
  })) };
  const allocation = { ...scope, campaignId: id(41), allocationId: id(80) };
  const award = { entitlementId: id(90), beneficiaryKind: "athlete", beneficiaryId: id(1000), beneficiaryName: "Synthetic runner", amountWei: wei(70) };
  const page = { ...allocation, items: [award], nextCursor: null };
  const detail = { ...allocation, ...award, reservedAt, sourceSnapshotId: id(71), sourceCount: 1, nextCursor: null,
    breakdown: [
      { family: "podium", scopeId: id(33), scopeName: "Synthetic division", amountWei: wei(50), sourceCount: 1,
        calculation: { method: "podium", divisionBudgetWei: wei(100), rank: 1, tieSize: 1, sharedPrizeWei: wei(50), prizeSlots: [1], clubScore: null } },
      { family: "record", scopeId: `${id(302)}:M`, scopeName: null, amountWei: wei(20), sourceCount: 1,
        calculation: { method: "record", divisionBudgetWei: wei(20), baselineTimeMs: "1100000", finishTimeMs: "1000000", tiedHolders: 1 } },
    ], sources: [{ sourceId: id(3010), roundId: id(101), roundNumber: 1, raceId: id(302), publicationId: id(602), athleteId: id(1000),
      athleteName: "Synthetic runner", representedClubId: id(2000), finishTimeMs: "1000000", distanceMetres: "5000", clubPointsHundredths: "10000",
      contributions: [{ family: "podium", scopeId: id(33) }, { family: "record", scopeId: `${id(302)}:M` }] }],
  };
  return { identity, scope, allocation, selected: { ...allocation, entitlementId: id(90) }, campaigns, page, detail };
}
