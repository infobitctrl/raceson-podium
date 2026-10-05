import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentArray as array, rewardDocumentObject as object,
  rewardDocumentInteger as integer, rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value: unknown): asserts value {
  if (!value) throw new RewardLedgerStoreError("invalid_reward_claim_history_document");
}
function timestamp(value: unknown): string {
  parseRewardSourceTimestamp(value); return value as string;
}
export function decodeRewardAthleteClaimHistory(raw: unknown, chainId: 10143 | 31337) {
  const d = object(raw, ["intentId", "programmeId", "campaignId", "entitlementId", "scopeKey", "pot", "chainId",
    "amountWei", "recipientAddress", "issuedAt", "expiresAt", "preparedAt", "recipientConsentRecordedAt", "operatorApprovalRecordedAt"]);
  demand(d.chainId === chainId && (d.pot === "race" || d.pot === "league"));
  const scopeKey = d.pot === "race" ? uuid(d.scopeKey) : d.scopeKey;
  demand(d.pot !== "league" || scopeKey === "rounds-1-5");
  demand(typeof d.recipientAddress === "string" && /^0x[0-9a-f]{40}$/.test(d.recipientAddress) && BigInt(d.recipientAddress) > 0n);
  const amountWei = integer(d.amountWei), issuedAt = integer(d.issuedAt), expiresAt = integer(d.expiresAt);
  demand(amountWei > 0n && issuedAt > 0n && expiresAt > issuedAt && expiresAt < (1n << 64n) && expiresAt - issuedAt <= 86400n);
  const preparedAt = timestamp(d.preparedAt);
  const recipientConsentRecordedAt = d.recipientConsentRecordedAt === null ? null : timestamp(d.recipientConsentRecordedAt);
  const operatorApprovalRecordedAt = d.operatorApprovalRecordedAt === null ? null : timestamp(d.operatorApprovalRecordedAt);
  demand(recipientConsentRecordedAt === null || Date.parse(recipientConsentRecordedAt) >= Date.parse(preparedAt));
  demand(operatorApprovalRecordedAt === null || (recipientConsentRecordedAt !== null
    && Date.parse(operatorApprovalRecordedAt) >= Date.parse(recipientConsentRecordedAt)));
  return { intentId: uuid(d.intentId), programmeId: uuid(d.programmeId), campaignId: uuid(d.campaignId),
    entitlementId: uuid(d.entitlementId), scopeKey: scopeKey as string, pot: d.pot, chainId, amountWei,
    recipientAddress: d.recipientAddress as `0x${string}`, issuedAt, expiresAt, preparedAt,
    recipientConsentRecordedAt, operatorApprovalRecordedAt };
}

/** Private RPC with an intentionally minimal result. Recorded timestamps are
 * historical facts, not signature verification, current claimability or receipts.
 * Scope comes exclusively from verified Auth plus server demo configuration. */
export async function listRewardAthleteClaims(identity: RewardAccountIdentity, input: {
  chainId: 10143 | 31337; afterId?: string | null;
}, rpc?: RewardLedgerRpc) {
  const userId = uuid(identity.userId), sessionId = uuid(identity.sessionId);
  const chainId = input.chainId, afterId = input.afterId == null ? null : uuid(input.afterId);
  demand(chainId === 10143 || chainId === 31337);
  let result: { data: unknown; error: unknown };
  try {
    result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_list_reward_athlete_claims",
      { p_user_id: userId, p_session_id: sessionId, p_chain_id: chainId, p_after_id: afterId });
  } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(code === "reward_account_session_required" || code === "invalid_reward_claim_history_request"
      ? code : "reward_ledger_store_failed");
  }
  const body = object(result.data, ["items", "nextCursor"]);
  let previous = afterId;
  const items = array(body.items, 50, raw => {
    const item = decodeRewardAthleteClaimHistory(raw, chainId);
    demand(previous === null || item.intentId > previous); previous = item.intentId; return item;
  });
  const nextCursor = body.nextCursor === null ? null : uuid(body.nextCursor);
  demand(nextCursor === null || (items.length === 50 && nextCursor === previous));
  return { items, nextCursor };
}
