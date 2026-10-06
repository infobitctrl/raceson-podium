import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type RewardClubTreasuryCandidate = {
  safeAddress: `0x${string}`; singletonAddress: `0x${string}`; fallbackHandlerAddress: `0x${string}`; owners: `0x${string}`[];
};
function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_club_treasury_document"); }
function chain(value: number) { demand(value === 31337 || value === 10143); return value; }
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function address(value: unknown): `0x${string}` {
  demand(typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) > 1n); return value as `0x${string}`;
}
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
/** Candidate shape only. No RPC, deployed-code, key control or approval claim. */
export function decodeRewardClubTreasuryCandidate(raw: unknown): RewardClubTreasuryCandidate {
  const c = object(raw, ["safeAddress", "singletonAddress", "fallbackHandlerAddress", "owners"]);
  const safeAddress = address(c.safeAddress), singletonAddress = address(c.singletonAddress), fallbackHandlerAddress = address(c.fallbackHandlerAddress);
  demand(new Set([safeAddress, singletonAddress, fallbackHandlerAddress]).size === 3);
  demand(Array.isArray(c.owners) && c.owners.length === 3);
  const owners = c.owners.map(address);
  demand(owners[0] < owners[1] && owners[1] < owners[2] && !owners.includes(safeAddress));
  return { safeAddress, singletonAddress, fallbackHandlerAddress, owners };
}
const scope = (s: RewardAccountIdentity, chainId: number) => ({ userId: uuid(s.userId), sessionId: uuid(s.sessionId), chainId: chain(chainId) });
const argsFor = (s: ReturnType<typeof scope>) => ({ p_user_id: s.userId, p_session_id: s.sessionId, p_chain_id: s.chainId });
const safeErrors = new Set(["reward_account_session_required", "reward_demo_account_required", "reward_club_owner_required", "reward_club_treasury_not_found",
  "reward_club_treasury_withdraw_first", "invalid_reward_club_treasury_request", "reward_ledger_idempotency_conflict"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}
export function decodeRewardClubTreasuryDocument(raw: unknown, s: Pick<ReturnType<typeof scope>, "userId" | "chainId">) {
  uuid(s.userId); chain(s.chainId);
  const r = object(raw, ["requestId", "userId", "sessionId", "clubId", "chainId", "candidate", "requestedAt", "idempotencyKey", "withdrawnAt", "status"]);
  demand(r.userId === s.userId && r.chainId === s.chainId);
  demand(r.status === "pending_review" || r.status === "identity_hold" || r.status === "withdrawn");
  const requestedAt = timestamp(r.requestedAt), withdrawnAt = r.withdrawnAt === null ? null : timestamp(r.withdrawnAt);
  demand((r.status === "withdrawn") === (withdrawnAt !== null) && (withdrawnAt === null || Date.parse(withdrawnAt) >= Date.parse(requestedAt)));
  return { requestId: uuid(r.requestId), userId: s.userId, sessionId: uuid(r.sessionId), clubId: uuid(r.clubId), chainId: s.chainId,
    candidate: decodeRewardClubTreasuryCandidate(r.candidate), requestedAt, idempotencyKey: key(r.idempotencyKey), withdrawnAt, status: r.status };
}
const decode = decodeRewardClubTreasuryDocument;
export async function requestRewardClubTreasury(identity: RewardAccountIdentity, chainId: number,
  input: { clubId: string; candidate: RewardClubTreasuryCandidate; idempotencyKey: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, chainId), clubId = uuid(input.clubId), candidate = decodeRewardClubTreasuryCandidate(input.candidate), idempotencyKey = key(input.idempotencyKey);
  const result = decode(await call("service_request_reward_club_treasury", { ...argsFor(s), p_club_id: clubId, p_candidate: candidate, p_idempotency_key: idempotencyKey }, rpc), s);
  demand(result.clubId === clubId && result.idempotencyKey === idempotencyKey && JSON.stringify(result.candidate) === JSON.stringify(candidate));
  // A same-account retry from a new session returns the original session's history.
  return result;
}
export async function readRewardClubTreasury(identity: RewardAccountIdentity, chainId: number, requestId: string, rpc?: RewardLedgerRpc) {
  const s = scope(identity, chainId), id = uuid(requestId);
  const result = decode(await call("service_read_reward_club_treasury", { ...argsFor(s), p_request_id: id }, rpc), s);
  demand(result.requestId === id); return result;
}
export async function listRewardClubTreasuries(identity: RewardAccountIdentity, chainId: number, afterId: string | null = null, rpc?: RewardLedgerRpc) {
  const s = scope(identity, chainId), after = afterId === null ? null : uuid(afterId);
  const body = object(await call("service_list_reward_club_treasuries", { ...argsFor(s), p_after_id: after }, rpc), ["items", "nextCursor"]);
  demand(Array.isArray(body.items) && body.items.length <= 25); let previous = after;
  const items = body.items.map(raw => { const r = decode(raw, s); demand(previous === null || r.requestId > previous); previous = r.requestId; return r; });
  const nextCursor = body.nextCursor === null ? null : uuid(body.nextCursor);
  demand(nextCursor === null || (items.length === 25 && nextCursor === previous)); return { items, nextCursor };
}
export async function withdrawRewardClubTreasury(identity: RewardAccountIdentity, chainId: number, requestId: string, rpc?: RewardLedgerRpc) {
  const s = scope(identity, chainId), id = uuid(requestId);
  const result = decode(await call("service_withdraw_reward_club_treasury", { ...argsFor(s), p_request_id: id }, rpc), s);
  demand(result.requestId === id && result.status === "withdrawn"); return result;
}
export async function listRewardOwnedClubs(identity: RewardAccountIdentity, chainId: number, afterId: string | null = null, rpc?: RewardLedgerRpc) {
  const s = scope(identity, chainId), after = afterId === null ? null : uuid(afterId);
  const body = object(await call("service_list_reward_owned_clubs", { ...argsFor(s), p_after_id: after }, rpc), ["chainId", "items", "nextCursor"]);
  demand(body.chainId === s.chainId && Array.isArray(body.items) && body.items.length <= 25); let previous = after;
  const items = body.items.map(raw => {
    const item = object(raw, ["clubId", "name"]), clubId = uuid(item.clubId);
    demand((previous === null || clubId > previous) && typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 1000);
    previous = clubId; return { clubId, name: item.name };
  });
  const nextCursor = body.nextCursor === null ? null : uuid(body.nextCursor);
  demand(nextCursor === null || (items.length === 25 && nextCursor === previous)); return { chainId: s.chainId, items, nextCursor };
}
