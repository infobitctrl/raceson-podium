import { listRewardClubAwards, listRewardClubClaims, readRewardClubPaymentStatus, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { decodeClubRewardPayment } from "@raceson/domain/rewards";
import type { RewardPortalConfig } from "./request-identity.js";
type Deps = RewardPortalConfig & { rpc?: RewardLedgerRpc };
export function getClubRewardAwards(identity: RewardAccountIdentity, clubId: string, afterId: string | null, deps: Deps) {
  return listRewardClubAwards(identity, { chainId: deps.chainId, clubId, afterId }, deps.rpc);
}
export function getClubRewardClaims(identity: RewardAccountIdentity, afterId: string | null, deps: Deps) {
  return listRewardClubClaims(identity, { chainId: deps.chainId, afterId }, deps.rpc);
}
/** No private signed transaction, witness or operator identity crosses HTTP. */
export async function getClubRewardPaymentStatus(identity: RewardAccountIdentity, intentId: string, deps: Deps) {
  const { claim, status, receipt: r } = await readRewardClubPaymentStatus(identity, { chainId: deps.chainId, intentId }, deps.rpc);
  return decodeClubRewardPayment({ claim, status, receipt: r === null ? null : {
    transactionHash: r.transactionHash, contractAddress: r.contractAddress, blockNumber: r.blockNumber.toString(), blockHash: r.blockHash,
    blockTimestamp: r.blockTimestamp.toString(), logIndex: r.logIndex, safeReceivedLogIndex: r.safeReceivedLogIndex,
    finalizedBlock: { number: r.finalizedBlock.number.toString(), hash: r.finalizedBlock.hash, timestamp: r.finalizedBlock.timestamp.toString() },
    recordedAt: r.recordedAt, observedAt: r.observedAt,
  } }, claim);
}
