import { readRewardAthletePaymentStatus, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import type { RewardPortalConfig } from "./request-identity.js";

/** Explicit browser whitelist; no signed attempts, operator session/lease,
 * private witness, consent signature, aggregate balance or payability claim. */
export async function getAthleteRewardPaymentStatus(identity: RewardAccountIdentity, intentId: string,
  deps: RewardPortalConfig & { rpc?: RewardLedgerRpc }) {
  const { claim: c, status, receipt: r } = await readRewardAthletePaymentStatus(identity, { chainId: deps.chainId, intentId }, deps.rpc);
  return { intentId: c.intentId, programmeId: c.programmeId, campaignId: c.campaignId, entitlementId: c.entitlementId,
    scopeKey: c.scopeKey, pot: c.pot, chainId: c.chainId, amountWei: c.amountWei.toString(), recipientAddress: c.recipientAddress,
    status, receipt: r === null ? null : { transactionHash: r.transactionHash, contractAddress: r.contractAddress,
      blockNumber: r.blockNumber.toString(), blockHash: r.blockHash, blockTimestamp: r.blockTimestamp.toString(), logIndex: r.logIndex,
      finalizedBlock: { number: r.finalizedBlock.number.toString(), hash: r.finalizedBlock.hash, timestamp: r.finalizedBlock.timestamp.toString() },
      recordedAt: r.recordedAt, observedAt: r.observedAt } };
}
