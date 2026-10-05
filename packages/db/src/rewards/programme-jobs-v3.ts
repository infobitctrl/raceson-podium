import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { decodeProgrammeDeploymentV3 } from "./programme-deployment-v3.js";
import type { ProgrammeAttemptScopeV3 } from "./programme-attempt-v3.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as uint } from "./stored-documents.js";

function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_programme_job"); }
const hash = (v: unknown) => { check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n); return v as `0x${string}`; };
const address = (v: unknown) => { check(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) !== 0n); return v as `0x${string}`; };
const timestamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
const nullableUuid = (v: unknown) => v === null ? null : uuid(v);
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_programme_deployment_required",
  "reward_programme_approval_required", "reward_programme_attempt_required", "invalid_reward_programme_job", "reward_programme_job_conflict",
  "reward_programme_job_required", "reward_programme_lease_lost", "invalid_reward_programme_provenance", "reward_programme_not_verified"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result;
  try { result = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const m = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable");
  }
  return result.data;
}
function base(identity: RewardAccountIdentity, input: Omit<ProgrammeAttemptScopeV3, "intentId">) {
  check(input.chainId === 31337 || input.chainId === 10143);
  return { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: input.chainId, p_draft_id: uuid(input.draftId) };
}
function decodeJob(value: unknown, actor: string, intent: string) {
  const r = object(value, ["jobId", "intentId", "attemptId", "transactionHash", "createdByUserId", "createdAt", "state",
    "mayHaveBroadcast", "leaseOwner", "leaseToken", "leaseExpiresAt", "leaseGeneration"]);
  check(r.createdByUserId === actor && r.intentId === intent && typeof r.state === "string"
    && ["queued", "leased", "broadcasting", "submitted", "confirmed"].includes(r.state)
    && typeof r.mayHaveBroadcast === "boolean" && typeof r.leaseGeneration === "number" && Number.isSafeInteger(r.leaseGeneration) && r.leaseGeneration >= 0);
  const leaseOwner = nullableUuid(r.leaseOwner), leaseToken = nullableUuid(r.leaseToken), leaseExpiresAt = r.leaseExpiresAt === null ? null : timestamp(r.leaseExpiresAt);
  check((leaseOwner === null) === (leaseToken === null) && (leaseOwner === null) === (leaseExpiresAt === null)
    && (r.state !== "confirmed" || leaseOwner === null && r.mayHaveBroadcast)
    && (r.state !== "queued" || leaseOwner === null && r.leaseGeneration === 0 && !r.mayHaveBroadcast)
    && (!["leased", "broadcasting", "submitted"].includes(r.state) || leaseOwner !== null && r.leaseGeneration > 0)
    && (!["broadcasting", "submitted"].includes(r.state) || r.mayHaveBroadcast));
  return { jobId: uuid(r.jobId), intentId: intent, attemptId: uuid(r.attemptId), transactionHash: hash(r.transactionHash),
    createdByUserId: actor, createdAt: timestamp(r.createdAt), state: r.state as "queued" | "leased" | "broadcasting" | "submitted" | "confirmed",
    mayHaveBroadcast: r.mayHaveBroadcast, leaseOwner, leaseToken, leaseExpiresAt, leaseGeneration: r.leaseGeneration };
}
export type ProgrammeJobV3 = ReturnType<typeof decodeJob>;
export { decodeJob as decodeRewardOperatorJobV3 };

/** Minimal immutable provenance, not a fresh funding balance or source approval. */
export function decodeProgrammeProvenanceV3(value: unknown) {
  const r = object(value, ["schemaVersion", "chainId", "contractAddress", "transactionHash", "deploymentBlockNumber", "deploymentBlockHash",
    "finalizedBlockNumber", "finalizedBlockHash", "finalizedBlockTimestamp", "runtimeCodeHash", "programmeId", "programmeManifestHash"]);
  check(r.schemaVersion === 3 && (r.chainId === 31337 || r.chainId === 10143));
  const deploymentBlockNumber = uint(r.deploymentBlockNumber), finalizedBlockNumber = uint(r.finalizedBlockNumber), finalizedBlockTimestamp = uint(r.finalizedBlockTimestamp);
  check(deploymentBlockNumber > 0n && finalizedBlockNumber >= deploymentBlockNumber && finalizedBlockTimestamp > 0n);
  return { schemaVersion: 3 as const, chainId: r.chainId, contractAddress: address(r.contractAddress), transactionHash: hash(r.transactionHash),
    deploymentBlockNumber, deploymentBlockHash: hash(r.deploymentBlockHash), finalizedBlockNumber, finalizedBlockHash: hash(r.finalizedBlockHash),
    finalizedBlockTimestamp, runtimeCodeHash: hash(r.runtimeCodeHash), programmeId: hash(r.programmeId), programmeManifestHash: hash(r.programmeManifestHash) };
}
export async function readProgrammeJobV3(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3, rpc?: RewardLedgerRpc) {
  const args = { ...base(identity, input), p_intent_id: uuid(input.intentId) };
  const raw = await call("service_read_reward_programme_job_v3", args, rpc);
  return raw === null ? null : decodeJob(raw, args.p_actor_user_id, args.p_intent_id);
}
export async function queueProgrammeJobV3(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3 & { jobId: string; attemptId: string }, rpc?: RewardLedgerRpc) {
  const args = { ...base(identity, input), p_intent_id: uuid(input.intentId), p_job_id: uuid(input.jobId), p_attempt_id: uuid(input.attemptId) };
  const result = decodeJob(await call("service_queue_reward_programme_job_v3", args, rpc), args.p_actor_user_id, args.p_intent_id);
  check(result.jobId === args.p_job_id && result.attemptId === args.p_attempt_id); return result;
}
export async function stepProgrammeJobV3(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3 & { jobId: string; workerId: string;
  leaseToken: string | null; action: "lease" | "arm" | "submitted" | "confirm"; provenance?: unknown }, rpc?: RewardLedgerRpc) {
  const args = { ...base(identity, input), p_intent_id: uuid(input.intentId), p_job_id: uuid(input.jobId), p_worker_id: uuid(input.workerId),
    p_lease_token: nullableUuid(input.leaseToken), p_action: input.action, p_provenance: input.provenance === undefined ? null : copy(input.provenance) };
  check(["lease", "arm", "submitted", "confirm"].includes(args.p_action) && (args.p_action !== "lease" || args.p_lease_token === null)
    && (args.p_action === "confirm") === (args.p_provenance !== null));
  if (args.p_provenance !== null) check(decodeProgrammeProvenanceV3(args.p_provenance).chainId === args.p_chain_id);
  const raw = await call("service_step_reward_programme_job_v3", args, rpc);
  if (raw === null) { check(args.p_action === "lease"); return null; }
  const r = decodeJob(raw, args.p_actor_user_id, args.p_intent_id);
  check(r.jobId === args.p_job_id && (r.state === "confirmed" || r.leaseOwner === args.p_worker_id && r.leaseToken !== null
    && (args.p_action === "lease" || r.leaseToken === args.p_lease_token)));
  check(r.state === "confirmed" || (args.p_action === "lease" ? ["leased", "broadcasting", "submitted"].includes(r.state)
    : r.state === (args.p_action === "arm" ? "broadcasting" : args.p_action === "submitted" ? "submitted" : "confirmed")));
  return r;
}
/** Authorized organizer read: no signed bytes or lease tokens. */
export async function readProgrammeRegistryV3(identity: RewardAccountIdentity, input: Omit<ProgrammeAttemptScopeV3, "intentId">, rpc?: RewardLedgerRpc) {
  const args = base(identity, input);
  return decodeProgrammeRegistryV3(await call("service_read_reward_programme_registry_v3", args, rpc),
    { chainId: args.p_chain_id, draftId: args.p_draft_id });
}
export function decodeProgrammeRegistryV3(value: unknown, input: Omit<ProgrammeAttemptScopeV3, "intentId">) {
  const args = { p_chain_id: input.chainId, p_draft_id: uuid(input.draftId) };
  check(args.p_chain_id === 31337 || args.p_chain_id === 10143);
  const r = object(value, ["schema", "context", "registry"]);
  check(r.schema === "raceson-programme-registry-v3");
  const context = decodeProgrammeDeploymentV3(r.context);
  check(context.approvalView.record.draftId === args.p_draft_id && context.approvalView.record.chainId === args.p_chain_id);
  if (r.registry === null) return { context, registry: null };
  const v = object(r.registry, ["jobId", "intentId", "attemptId", "provenance", "recordedAt"]), provenance = decodeProgrammeProvenanceV3(v.provenance);
  check(v.intentId === context.intent?.id && provenance.chainId === args.p_chain_id);
  return { context, registry: { jobId: uuid(v.jobId), intentId: uuid(v.intentId), attemptId: uuid(v.attemptId), provenance, recordedAt: timestamp(v.recordedAt) } };
}
