import { claimFixture } from "./claimFixtures.test-helper";
import type { AthletePaymentStage, AthletePaymentStatus } from "./athletePaymentStatus";

export function paymentFixture(status: AthletePaymentStage = "confirmed", chainId: 31337 | 10143 = 31337) {
  const { history } = claimFixture(chainId), now = Math.floor(Date.now() / 1000);
  const payment: AthletePaymentStatus = { intentId: history.intentId, programmeId: history.programmeId, campaignId: history.campaignId,
    entitlementId: history.entitlementId, scopeKey: history.scopeKey, pot: history.pot, chainId, amountWei: history.amountWei,
    recipientAddress: history.recipientAddress, status, receipt: status === "confirmed" ? {
      transactionHash: `0x${"aa".repeat(32)}`, contractAddress: `0x${"cd".repeat(20)}`, blockNumber: "100", blockHash: `0x${"bb".repeat(32)}`,
      blockTimestamp: String(now), logIndex: 0, finalizedBlock: { number: "100", hash: `0x${"bb".repeat(32)}`, timestamp: String(now) },
      recordedAt: new Date((now + 1) * 1000).toISOString(), observedAt: new Date(now * 1000).toISOString(),
    } : null };
  return { history, payment };
}
