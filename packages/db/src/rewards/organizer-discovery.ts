import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentArray as array, rewardDocumentObject as object,
  rewardDocumentInteger as integer, rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value: unknown): asserts value {
  if (!value) throw new RewardLedgerStoreError("invalid_reward_discovery_document");
}
function label(value: unknown): string | null {
  if (value === null) return null;
  demand(typeof value === "string" && value.trim() === value && value.length > 0 && [...value].length <= 256);
  return value;
}
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required",
  "reward_readiness_scope_required", "invalid_reward_discovery_request"]);
async function request(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((method, input) => createAdminSupabaseClient().rpc(method, input)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safeErrors.has(code) ? code : "reward_ledger_store_failed");
  }
  return result.data;
}
function args(identity: RewardAccountIdentity, input: { chainId: 10143 | 31337; afterId?: string | null }) {
  demand(input.chainId === 10143 || input.chainId === 31337);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId),
    p_chain_id: input.chainId, p_after_id: input.afterId == null ? null : uuid(input.afterId) };
}
function page<T>(body: Record<string, unknown>, afterId: string | null, decode: (raw: unknown) => T, id: (row: T) => string) {
  let previous = afterId;
  const items = array(body.items, 25, raw => {
    const item = decode(raw), key = id(item);
    demand(previous === null || key > previous); previous = key; return item;
  });
  const nextCursor = body.nextCursor === null ? null : uuid(body.nextCursor);
  demand(nextCursor === null || (items.length === 25 && nextCursor === previous));
  return { items, nextCursor };
}

/** Explicit whitelist: labels are current display metadata, budget is frozen
 * configuration, and neither this list nor its cursor proves funding/readiness. */
export async function listRewardOperatorProgrammes(identity: RewardAccountIdentity, input: {
  chainId: 10143 | 31337; afterId?: string | null;
}, rpc?: RewardLedgerRpc) {
  const fixed = args(identity, input);
  const body = object(await request("service_list_reward_operator_programmes", fixed, rpc), ["chainId", "items", "nextCursor"]);
  demand(body.chainId === fixed.p_chain_id);
  return { chainId: fixed.p_chain_id, ...page(body, fixed.p_after_id, raw => {
    const d = object(raw, ["programmeId", "organizationId", "seasonId", "year", "leagueName", "seasonName", "budgetWei", "createdAt"]);
    demand(typeof d.year === "number" && Number.isInteger(d.year) && d.year >= 2000 && d.year <= 2200);
    const budgetWei = integer(d.budgetWei); demand(budgetWei >= 9n);
    return { programmeId: uuid(d.programmeId), organizationId: uuid(d.organizationId), seasonId: uuid(d.seasonId),
      year: d.year, leagueName: label(d.leagueName), seasonName: label(d.seasonName), budgetWei: budgetWei.toString(), createdAt: timestamp(d.createdAt) };
  }, row => row.programmeId) };
}

export async function listRewardOperatorDestinations(identity: RewardAccountIdentity, input: {
  programmeId: string; chainId: 10143 | 31337; afterId?: string | null;
}, rpc?: RewardLedgerRpc) {
  const fixed = { ...args(identity, input), p_programme_id: uuid(input.programmeId) };
  const body = object(await request("service_list_reward_operator_destinations", fixed, rpc), ["programmeId", "chainId", "items", "nextCursor"]);
  demand(body.chainId === fixed.p_chain_id && body.programmeId === fixed.p_programme_id);
  return { programmeId: fixed.p_programme_id, chainId: fixed.p_chain_id, ...page(body, fixed.p_after_id, raw => {
    const d = object(raw, ["requestId", "athleteProfileId", "athleteName", "address", "requestedAt", "destinationStatus"]);
    demand(typeof d.address === "string" && /^0x[0-9a-f]{40}$/.test(d.address) && BigInt(d.address) > 0n);
    demand(d.destinationStatus === "pending_review" || d.destinationStatus === "identity_hold" || d.destinationStatus === "withdrawn");
    return { requestId: uuid(d.requestId), athleteProfileId: uuid(d.athleteProfileId), athleteName: label(d.athleteName),
      address: d.address, requestedAt: timestamp(d.requestedAt), destinationStatus: d.destinationStatus };
  }, row => row.requestId) };
}
