import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentArray as array, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardClubReviewContext } from "./club-treasury-reviews.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
function demand(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_operator_club_document"); }
function label(v: unknown): string | null { if (v === null) return null; demand(typeof v === "string" && v.trim() === v && v.length > 0 && [...v].length <= 256); return v; }
function scope(i: RewardAccountIdentity, s: { programmeId: string; chainId: 31337 | 10143 }) {
  demand(s.chainId === 31337 || s.chainId === 10143);
  return { p_actor_user_id: uuid(i.userId), p_actor_session_id: uuid(i.sessionId), p_programme_id: uuid(s.programmeId), p_chain_id: s.chainId };
}
const safe = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_club_review_scope_required", "reward_club_review_identity_changed"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let response;
  try { response = await (rpc ?? ((method, body) => createAdminSupabaseClient().rpc(method, body)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (response.error) { const message = typeof response.error === "object" ? (response.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_store_failed"); }
  return response.data;
}
export async function listRewardOperatorClubTreasuries(identity: RewardAccountIdentity,
  input: { programmeId: string; chainId: 31337 | 10143; afterId?: string | null }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input), after = input.afterId == null ? null : uuid(input.afterId);
  const body = object(await call("service_list_reward_operator_club_treasuries", { ...s, p_after_id: after }, rpc), ["programmeId", "chainId", "items", "nextCursor"]);
  demand(body.programmeId === s.p_programme_id && body.chainId === s.p_chain_id); let last = after;
  const items = array(body.items, 25, raw => {
    const r = object(raw, ["requestId", "clubId", "clubName", "address", "requestedAt", "nominationStatus"]), requestId = uuid(r.requestId);
    demand(last === null || requestId > last); last = requestId;
    demand(typeof r.address === "string" && /^0x[0-9a-f]{40}$/.test(r.address) && BigInt(r.address) > 1n);
    demand(r.nominationStatus === "pending_review" || r.nominationStatus === "identity_hold" || r.nominationStatus === "withdrawn"); parseRewardSourceTimestamp(r.requestedAt);
    return { requestId, clubId: uuid(r.clubId), clubName: label(r.clubName), address: r.address as `0x${string}`,
      requestedAt: r.requestedAt as string, nominationStatus: r.nominationStatus };
  });
  const nextCursor = body.nextCursor === null ? null : uuid(body.nextCursor); demand(nextCursor === null || (items.length === 25 && nextCursor === last));
  return { programmeId: s.p_programme_id, chainId: s.p_chain_id, items, nextCursor };
}
export async function readRewardOperatorClubTreasury(identity: RewardAccountIdentity,
  input: { programmeId: string; chainId: 31337 | 10143; requestId: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input), id = uuid(input.requestId);
  const body = object(await call("service_read_reward_operator_club_treasury", { ...s, p_request_id: id }, rpc), ["context", "labels"]);
  const context = decodeRewardClubReviewContext(body.context, { userId: s.p_actor_user_id }, s.p_programme_id, id);
  demand(context.chainId === s.p_chain_id); const labels = object(body.labels, ["clubName", "ownerProfileId", "ownerName"]);
  return { context, labels: { clubName: label(labels.clubName), ownerProfileId: labels.ownerProfileId === null ? null : uuid(labels.ownerProfileId), ownerName: label(labels.ownerName) } };
}
