import { decodeRoundPublicationChangeV3, decodeRoundPublicationV3, type RoundPublicationScopeV3,
  type RoundPublicationChangeV3 } from "@raceson/domain/rewards/round-publication-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_allocation_upload_not_found", "reward_allocation_not_ready", "reward_round_publication_conflict",
  "reward_round_publication_unsupported", "reward_round_review_pending"]);
/** Private service-only clock mutation; no caller-supplied timestamps or chain IO. */
export async function rewardRoundPublicationV3(identity: RewardAccountIdentity, scope: RoundPublicationScopeV3,
  change: RoundPublicationChangeV3 | undefined, rpc?: RewardLedgerRpc) {
  const s = { ...scope }, c = change && decodeRoundPublicationChangeV3(change);
  if (![31337, 10143].includes(s.chainId) || !Number.isInteger(s.slot) || s.slot < 1 || s.slot > 4
    || !/^[0-9a-f]{64}$/.test(s.packageHash) || (c && c.packageHash !== s.packageHash)) throw new RewardLedgerStoreError("invalid_reward_round_publication");
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: s.chainId,
    p_draft_id: uuid(s.draftId), p_slot: s.slot, p_approval_id: uuid(s.approvalId), p_upload_id: uuid(s.uploadId),
    p_action: c?.action ?? "read", p_request_id: c?.requestId ?? null, p_review_id: c?.reviewId ?? null, p_package_hash: c?.packageHash ?? null };
  let result;
  try { result = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))("service_reward_round_publication_v3", args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) { const m = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable"); }
  const view = decodeRoundPublicationV3(result.data, s);
  if (c && (c.action === "start" ? view.review?.id : view.publication?.id) !== c.requestId)
    throw new RewardLedgerStoreError("invalid_reward_round_publication");
  return { schema: "raceson-round-publication-view-v3" as const, ...view };
}
