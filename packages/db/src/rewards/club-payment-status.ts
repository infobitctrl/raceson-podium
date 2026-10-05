import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentInteger as integer, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeClubRewardClaim } from "@raceson/domain/rewards";
import { decodeRewardCampaignDeployment, decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value: unknown): asserts value {
  if (!value) throw new RewardLedgerStoreError("invalid_reward_payment_status_document");
}
const hash = (v: unknown): `0x${string}` => {
  demand(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n); return v as `0x${string}`;
};
const address = (v: unknown): `0x${string}` => {
  demand(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) > 0n); return v as `0x${string}`;
};
const timestamp = (v: unknown): string => { parseRewardSourceTimestamp(v); return v as string; };
const safeNumber = (v: unknown): number => { demand(typeof v === "number" && Number.isSafeInteger(v) && v >= 0); return v; };
const statuses = ["no_confirmation", "queued", "processing", "submission_unconfirmed", "confirmed"] as const;
export type RewardClubPaymentStatus = typeof statuses[number];

/** A read of evidence already atomically verified/committed by the payment
 * worker, NOT a fresh chain observation or an independent consensus proof.
 * Missing receipts never establish unpaid state. Historical holds/expiry and
 * subsequent club ownership do not rewrite the original recipient's record. */
export async function readRewardClubPaymentStatus(identity: RewardAccountIdentity,
  input: { chainId: 10143 | 31337; intentId: string }, rpc?: RewardLedgerRpc) {
  const userId = uuid(identity.userId), sessionId = uuid(identity.sessionId);
  const chainId = input.chainId, intentId = uuid(input.intentId);
  demand(chainId === 10143 || chainId === 31337);
  let result: { data: unknown; error: unknown };
  try {
    result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_read_reward_club_payment_status",
      { p_user_id: userId, p_session_id: sessionId, p_chain_id: chainId, p_intent_id: intentId });
  } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && ["reward_account_session_required", "reward_payment_status_not_found",
      "invalid_reward_club_portal_request", "invalid_reward_payment_status_document"].includes(code) ? code : "reward_ledger_store_failed");
  }
  const raw = object(result.data, ["claim", "chainEntitlementId", "authorizationNonce", "allocationDigest", "status", "confirmation"]);
  const claim = decodeClubRewardClaim(raw.claim, chainId);
  demand(claim.intentId === intentId && statuses.some(status => status === raw.status));
  const status = raw.status as RewardClubPaymentStatus;
  const chainEntitlementId = hash(raw.chainEntitlementId), authorizationNonce = integer(raw.authorizationNonce), allocationDigest = hash(raw.allocationDigest);
  demand((status === "confirmed") === (raw.confirmation !== null));
  if (raw.confirmation === null) return { claim, status, receipt: null };

  const c = object(raw.confirmation, ["recordedAt", "transactionHash", "payment", "deployment", "observation", "observedAt"]);
  const d = decodeRewardCampaignDeployment(c.deployment), o = decodeRewardCampaignObservation(c.observation);
  const p = object(c.payment, ["schemaVersion", "action", "chainId", "contractAddress", "relayerAddress", "transactionHash", "nonce",
    "blockNumber", "blockHash", "blockTimestamp", "logIndex", "entitlementId", "recipient", "amount", "pot", "authorizationNonce",
    "allocationDigest", "gasLimit", "gasUsed", "effectiveGasPrice", "monadGasLimitFee", "runtimeCodeHash", "finalizedBlock", "safeReceivedLogIndex"]);
  const pot = claim.pot === "race" ? 0 : 1;
  demand(p.schemaVersion === 1 && p.action === "pay_club" && p.chainId === chainId && d.chainId === chainId
    && address(p.contractAddress) === d.contractAddress && hash(p.runtimeCodeHash) === d.runtimeCodeHash
    && hash(p.transactionHash) === hash(c.transactionHash) && hash(p.entitlementId) === chainEntitlementId
    && address(p.recipient) === claim.recipientAddress && integer(p.amount) === BigInt(claim.amountWei) && p.pot === claim.pot
    && integer(p.authorizationNonce) === authorizationNonce && hash(p.allocationDigest) === allocationDigest
    && integer(p.nonce) <= BigInt(Number.MAX_SAFE_INTEGER));
  demand(address(p.relayerAddress) !== claim.recipientAddress);
  const blockNumber = integer(p.blockNumber), blockHash = hash(p.blockHash), blockTimestamp = integer(p.blockTimestamp);
  const f = object(p.finalizedBlock, ["number", "hash", "timestamp"]);
  demand(integer(f.number) === o.finalizedBlock.number && hash(f.hash) === o.finalizedBlock.hash && integer(f.timestamp) === o.finalizedBlock.timestamp
    && blockNumber > d.deploymentBlockNumber && blockNumber <= o.finalizedBlock.number && blockTimestamp <= o.finalizedBlock.timestamp
    && blockTimestamp >= BigInt(claim.issuedAt) && blockTimestamp < BigInt(claim.expiresAt)
    && (blockNumber !== o.finalizedBlock.number || (blockHash === o.finalizedBlock.hash && blockTimestamp === o.finalizedBlock.timestamp))
    && o.accounting.allocationDigest === allocationDigest && o.accounting.paid[pot] >= BigInt(claim.amountWei));
  const gasLimit = integer(p.gasLimit), gasUsed = integer(p.gasUsed), price = integer(p.effectiveGasPrice);
  demand(gasLimit > 0n && gasLimit < (1n << 64n) && gasUsed > 0n && gasUsed <= gasLimit
    && integer(p.monadGasLimitFee) === gasLimit * price);
  demand(safeNumber(p.safeReceivedLogIndex) === safeNumber(p.logIndex) + 1);
  const recordedAt = timestamp(c.recordedAt), observedAt = timestamp(c.observedAt);
  demand(claim.operatorApprovalRecordedAt !== null && Date.parse(observedAt) >= Date.parse(claim.operatorApprovalRecordedAt)
    && Date.parse(recordedAt) >= Date.parse(observedAt));
  return { claim, status, receipt: { transactionHash: hash(p.transactionHash), contractAddress: d.contractAddress,
    blockNumber, blockHash, blockTimestamp, logIndex: safeNumber(p.logIndex), safeReceivedLogIndex: safeNumber(p.safeReceivedLogIndex), finalizedBlock: o.finalizedBlock, recordedAt, observedAt } };
}
