import type { ClubRewardAward, ClubRewardClaim, ClubRewardPayment } from "@raceson/domain/rewards";
const id = (n: number) => `7c600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
export function clubLedgerFixture() {
  const award: ClubRewardAward = { entitlementId: id(1), programmeId: id(2), campaignId: id(3), clubId: id(4), clubName: "Synthetic trail club",
    scopeKey: id(5), pot: "race", chainId: 31337, amountWei: "75000000000000000000", roundNumber: 1, raceName: "Synthetic round one" };
  const claim: ClubRewardClaim = { ...award, intentId: id(6), recipientAddress: `0x${"b".repeat(40)}`, issuedAt: "1788854400", expiresAt: "1788940800",
    preparedAt: "2026-09-08T08:00:00Z", recipientConsentRecordedAt: "2026-09-08T08:00:01Z", operatorApprovalRecordedAt: "2026-09-08T08:00:02Z" };
  const payment: ClubRewardPayment = { claim, status: "confirmed", receipt: { transactionHash: hash("c"), contractAddress: `0x${"d".repeat(40)}`,
    blockNumber: "50", blockHash: hash("e"), blockTimestamp: "1788854410", logIndex: 0, safeReceivedLogIndex: 1,
    finalizedBlock: { number: "60", hash: hash("f"), timestamp: "1788854420" }, recordedAt: "2026-09-08T08:00:22Z", observedAt: "2026-09-08T08:00:21Z" } };
  return { award, claim, payment, clubs: [{ clubId: award.clubId, name: award.clubName! }],
    awards: { items: [award, { ...award, entitlementId: id(7), campaignId: id(8), pot: "league" as const, scopeKey: "rounds-1-5", roundNumber: null, raceName: null,
      amountWei: "180000000000000000000" }], nextCursor: null }, claims: { items: [claim], nextCursor: null } };
}
