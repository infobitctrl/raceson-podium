import { requirePortal, rewardRecord as record, walletAddress } from "./athleteRewards";
import { claimInteger, claimTimestamp, decodeAthleteRewardClaim, type AthleteRewardClaim } from "./athleteClaims";

const statuses = ["no_confirmation", "queued", "processing", "submission_unconfirmed", "confirmed"] as const;
export type AthletePaymentStage = typeof statuses[number];
export type AthletePaymentReceipt = {
  transactionHash: `0x${string}`; contractAddress: `0x${string}`;
  blockNumber: string; blockHash: `0x${string}`; blockTimestamp: string; logIndex: number;
  finalizedBlock: { number: string; hash: `0x${string}`; timestamp: string };
  recordedAt: string; observedAt: string;
};
export type AthletePaymentStatus = Pick<AthleteRewardClaim, "intentId" | "programmeId" | "campaignId" | "entitlementId" |
  "scopeKey" | "pot" | "chainId" | "amountWei" | "recipientAddress"> & {
    status: AthletePaymentStage; receipt: AthletePaymentReceipt | null;
  };
const hash = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n;

/** Browser projection of the worker's recorded verification, not a chain verifier.
 * Match immutable preparation scope, never cached consent/approval status: a
 * payment may have been recorded since the history page was loaded. */
export function decodeAthletePaymentStatus(value: unknown, history: AthleteRewardClaim): AthletePaymentStatus {
  const fixed = decodeAthleteRewardClaim(history);
  const scope = ["intentId", "programmeId", "campaignId", "entitlementId", "scopeKey", "pot", "chainId", "amountWei", "recipientAddress"] as const;
  const raw = record(value, [...scope, "status", "receipt"]);
  requirePortal(scope.every(key => raw[key] === fixed[key]) && statuses.some(status => status === raw.status)
    && (raw.status === "confirmed") === (raw.receipt !== null));
  const summary = { intentId: fixed.intentId, programmeId: fixed.programmeId, campaignId: fixed.campaignId,
    entitlementId: fixed.entitlementId, scopeKey: fixed.scopeKey, pot: fixed.pot, chainId: fixed.chainId,
    amountWei: fixed.amountWei, recipientAddress: fixed.recipientAddress, status: raw.status as AthletePaymentStage };
  if (raw.receipt === null) return { ...summary, receipt: null };
  const r = record(raw.receipt, ["transactionHash", "contractAddress", "blockNumber", "blockHash", "blockTimestamp", "logIndex", "finalizedBlock", "recordedAt", "observedAt"]);
  const f = record(r.finalizedBlock, ["number", "hash", "timestamp"]);
  requirePortal(hash(r.transactionHash) && walletAddress(r.contractAddress) && r.contractAddress === r.contractAddress.toLowerCase()
    && claimInteger(r.blockNumber) && BigInt(r.blockNumber) > 0n && hash(r.blockHash) && claimInteger(r.blockTimestamp, 64)
    && BigInt(r.blockTimestamp) >= BigInt(fixed.issuedAt) && BigInt(r.blockTimestamp) < BigInt(fixed.expiresAt)
    && typeof r.logIndex === "number" && Number.isSafeInteger(r.logIndex) && r.logIndex >= 0
    && claimInteger(f.number) && hash(f.hash) && claimInteger(f.timestamp) && BigInt(f.number) >= BigInt(r.blockNumber)
    && BigInt(f.timestamp) >= BigInt(r.blockTimestamp)
    && (f.number !== r.blockNumber || (f.hash === r.blockHash && f.timestamp === r.blockTimestamp))
    && claimTimestamp(r.recordedAt) && claimTimestamp(r.observedAt)
    && Date.parse(r.observedAt) >= Date.parse(fixed.preparedAt) && Date.parse(r.recordedAt) >= Date.parse(r.observedAt));
  return { ...summary, receipt: { transactionHash: r.transactionHash, contractAddress: r.contractAddress,
    blockNumber: r.blockNumber, blockHash: r.blockHash, blockTimestamp: r.blockTimestamp, logIndex: r.logIndex,
    finalizedBlock: { number: f.number, hash: f.hash, timestamp: f.timestamp }, recordedAt: r.recordedAt, observedAt: r.observedAt } };
}
