import { createAdminSupabaseClient } from "../supabase.js";

export class RewardSourceStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RewardSourceStoreError"; }
}

export type RewardSourceScope = {
  organizationId: string; leagueSeasonId: string; roundIds: readonly string[]; actorUserId: string;
};
/** Raw private evidence, deliberately NOT RewardFinish or an approved allocation.
 *  The sporting adapter must validate every classification, identity and numeric
 *  field before constructing calculator inputs. Never return this from a public API. */
export type RewardSourceDocument = {
  schemaVersion: 1;
  season: Record<string, unknown> & { id: string; organizationId: string };
  rounds: Record<string, unknown>[];
  mappings: Record<string, unknown>[];
  competitions: Record<string, unknown>[];
  classifications: Record<string, unknown>[];
  adjudicationCases: Record<string, unknown>[];
  rows: Record<string, unknown>[];
};
export type RewardSourceSnapshot = {
  snapshotId: string; capturedAt: string; sourceFingerprintSha256: string; source: RewardSourceDocument;
};
type SourceRpcName = "service_read_reward_source" | "service_capture_reward_source";
export type RewardSourceRpc = (name: SourceRpcName, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function requireStore(condition: unknown, code: string): asserts condition {
  if (!condition) throw new RewardSourceStoreError(code);
}
function uuid(value: unknown): string {
  requireStore(typeof value === "string" && uuidPattern.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value), "invalid_reward_source_scope");
  return value.toLowerCase();
}
function scopeArgs(scope: RewardSourceScope) {
  const organizationId = uuid(scope.organizationId); const seasonId = uuid(scope.leagueSeasonId); const actorId = uuid(scope.actorUserId);
  requireStore(Array.isArray(scope.roundIds) && scope.roundIds.length >= 1 && scope.roundIds.length <= 5, "invalid_reward_source_scope");
  const roundIds = scope.roundIds.map(uuid).sort();
  requireStore(new Set(roundIds).size === roundIds.length, "invalid_reward_source_scope");
  return { p_organization_id: organizationId, p_league_season_id: seasonId, p_round_ids: roundIds, p_actor_user_id: actorId };
}

function sourceDocument(value: unknown, args: ReturnType<typeof scopeArgs>): RewardSourceDocument {
  requireStore(record(value) && value.schemaVersion === 1 && record(value.season), "invalid_reward_source_response");
  requireStore(value.season.id === args.p_league_season_id && value.season.organizationId === args.p_organization_id, "reward_source_response_scope_mismatch");
  for (const key of ["rounds", "mappings", "competitions", "classifications", "adjudicationCases", "rows"] as const) {
    requireStore(Array.isArray(value[key]) && value[key].length <= 20_000 && value[key].every(record), "invalid_reward_source_response");
  }
  const document = value as RewardSourceDocument;
  const returnedRounds = document.rounds.map((row) => row.id).sort();
  requireStore(JSON.stringify(returnedRounds) === JSON.stringify(args.p_round_ids), "reward_source_response_scope_mismatch");
  // Do not coerce arbitrary numeric strings, drop rows or infer approval here.
  return document;
}

const safeDatabaseErrors = new Set([
  "invalid_reward_source_scope", "invalid_reward_capture_key", "reward_source_permission_required",
  "reward_round_scope_mismatch", "reward_round_not_ready", "reward_mapping_source_not_ready",
  "reward_competition_not_active", "reward_source_too_large", "reward_capture_idempotency_conflict",
]);
async function callSourceRpc(name: SourceRpcName, args: Record<string, unknown>, injected?: RewardSourceRpc): Promise<unknown> {
  // One RPC is one database transaction. Authenticated HTTP service code supplies
  // actorUserId from its checked session, never from a browser-selected identity.
  const rpc: RewardSourceRpc = injected ?? ((method, parameters) => createAdminSupabaseClient().rpc(method, parameters));
  let result: { data: unknown; error: unknown };
  try { result = await rpc(name, args); }
  catch { throw new RewardSourceStoreError("reward_source_store_unavailable"); }
  if (result.error) {
    const message = record(result.error) ? result.error.message : null;
    throw new RewardSourceStoreError(typeof message === "string" && safeDatabaseErrors.has(message) ? message : "reward_source_store_failed");
  }
  return result.data;
}

/** Read current evidence for review/freshness checks; no snapshot/award is created. */
export async function readRewardSource(scope: RewardSourceScope, rpc?: RewardSourceRpc): Promise<RewardSourceDocument> {
  const args = scopeArgs(scope);
  return sourceDocument(await callSourceRpc("service_read_reward_source", args, rpc), args);
}

/** Atomically capture a database-sourced immutable document. Retrying the same key
 *  returns the old capture, not updated results; a new review uses a new key. */
export async function captureRewardSourceSnapshot(input: RewardSourceScope & { idempotencyKey: string }, rpc?: RewardSourceRpc): Promise<RewardSourceSnapshot> {
  const args = scopeArgs(input);
  requireStore(typeof input.idempotencyKey === "string" && input.idempotencyKey.length >= 8 && input.idempotencyKey.length <= 128, "invalid_reward_capture_key");
  const result = await callSourceRpc("service_capture_reward_source", { ...args, p_idempotency_key: input.idempotencyKey }, rpc);
  requireStore(record(result) && typeof result.snapshotId === "string" && uuidPattern.test(result.snapshotId)
    && typeof result.capturedAt === "string" && Number.isFinite(Date.parse(result.capturedAt))
    && typeof result.sourceFingerprintSha256 === "string" && /^[0-9a-f]{64}$/.test(result.sourceFingerprintSha256), "invalid_reward_capture_response");
  return { snapshotId: result.snapshotId, capturedAt: result.capturedAt, sourceFingerprintSha256: result.sourceFingerprintSha256,
    source: sourceDocument(result.source, args) };
}
