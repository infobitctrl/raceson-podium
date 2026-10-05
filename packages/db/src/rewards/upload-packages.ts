import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { decodeRewardCalculationContext } from "./calculation-context.js";
import { rewardDocumentInteger as integer, rewardDocumentUuid as uuid } from "./stored-documents.js";

const safeErrors = new Set(["reward_operator_permission_required", "reward_allocation_reference_mismatch", "invalid_reward_upload",
  "reward_upload_already_prepared", "reward_upload_reference_mismatch", "reward_upload_evidence_changed", "reward_review_superseded",
  "reward_review_source_changed", "reward_round_has_unresolved_adjudication", "reward_record_approval_mismatch",
  "reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_approval_omitted",
  "reward_record_source_changed", "reward_record_source_not_ready"]);
function demand(condition: unknown): asserts condition {
  if (!condition) throw new RewardLedgerStoreError("invalid_reward_upload_document");
}
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  demand(value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  const fields = Object.getOwnPropertyDescriptors(value);
  demand(Object.getOwnPropertySymbols(value).length === 0 && Object.values(fields).every((field) => field.enumerable && "value" in field));
  if (keys) demand(Object.keys(fields).length === keys.length && keys.every((key) => Object.hasOwn(fields, key)));
  return value as Record<string, unknown>;
}
function hash(value: unknown): `0x${string}` {
  demand(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`;
}
function address(value: unknown): `0x${string}` {
  demand(typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`;
}
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, injected?: RewardLedgerRpc) {
  const rpc: RewardLedgerRpc = injected ?? ((method, parameters) => createAdminSupabaseClient().rpc(method, parameters));
  let response: { data: unknown; error: unknown };
  try { response = await rpc(name, args); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (response.error) {
    const message = typeof response.error === "object" ? (response.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return response.data;
}

/** SENSITIVE SERVER ONLY. Salts and private entity IDs must not reach HTTP/logs. */
export async function readRewardAllocationExport(input: { campaignId: string; actorUserId: string; allocationId: string }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const allocationId = uuid(input.allocationId);
  const raw = object(await call("service_read_reward_allocation_export", { p_campaign_id: campaignId, p_actor_user_id: actorUserId,
    p_allocation_id: allocationId }, rpc), ["schemaVersion", "context", "chain", "allocation", "evidenceDocument"]);
  demand(raw.schemaVersion === 1);
  const allocation = object(raw.allocation, ["id", "reviewId", "snapshotSalt", "body", "entitlements"]);
  demand(allocation.id === allocationId && Array.isArray(allocation.entitlements) && allocation.entitlements.length <= 20000);
  const context = decodeRewardCalculationContext(raw.context, { campaignId, actorUserId, reviewId: uuid(allocation.reviewId) });
  const chain = object(raw.chain, ["programmeId", "campaignId", "programmeManifestHash", "operatorAddress", "treasuryAddress"]);
  const entitlements = allocation.entitlements.map((value) => {
    const row = object(value, ["id", "entitlementId", "beneficiaryId", "beneficiaryKind", "opaqueBeneficiaryId", "amountWei", "explanation", "explanationSalt"]);
    demand(row.beneficiaryKind === "athlete" || row.beneficiaryKind === "club");
    const beneficiaryKind: "athlete" | "club" = row.beneficiaryKind;
    const amountWei = integer(row.amountWei); demand(amountWei > 0n);
    return { id: uuid(row.id), entitlementId: hash(row.entitlementId), beneficiaryId: uuid(row.beneficiaryId), beneficiaryKind,
      opaqueBeneficiaryId: hash(row.opaqueBeneficiaryId), amountWei, explanation: copy(object(row.explanation)), explanationSalt: hash(row.explanationSalt) };
  });
  return { context, chain: { programmeId: hash(chain.programmeId), campaignId: hash(chain.campaignId),
    programmeManifestHash: hash(chain.programmeManifestHash), operatorAddress: address(chain.operatorAddress), treasuryAddress: address(chain.treasuryAddress) },
  allocation: { id: allocationId, reviewId: uuid(allocation.reviewId), snapshotSalt: hash(allocation.snapshotSalt), body: copy(object(allocation.body)), entitlements },
  evidenceDocument: copy(object(raw.evidenceDocument)) };
}

/** Upload/evidence must be computed by the service, never a browser payload. */
export async function saveRewardUploadPackage(input: { campaignId: string; actorUserId: string; allocationId: string;
  idempotencyKey: string; upload: unknown; evidenceDocument: unknown }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const allocationId = uuid(input.allocationId);
  const idempotencyKey = input.idempotencyKey;
  demand(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128);
  const upload = copy(object(input.upload)); const evidenceDocument = copy(object(input.evidenceDocument));
  const row = object(await call("service_save_reward_upload", { p_campaign_id: campaignId, p_actor_user_id: actorUserId,
    p_allocation_id: allocationId, p_idempotency_key: idempotencyKey, p_upload: upload, p_evidence: evidenceDocument }, rpc),
  ["uploadId", "campaignId", "allocationId", "preparedByUserId", "preparedAt", "upload"]);
  demand(row.campaignId === campaignId && row.allocationId === allocationId && row.preparedByUserId === actorUserId
    && JSON.stringify(copy(row.upload)) === JSON.stringify(upload));
  return { uploadId: uuid(row.uploadId), campaignId, allocationId, preparedByUserId: actorUserId, preparedAt: timestamp(row.preparedAt) };
}

/** Snapshot of DB evidence currentness, NOT an activation or broadcast permit. */
export async function checkRewardUploadEvidence(input: { campaignId: string; actorUserId: string; uploadId: string }, rpc?: RewardLedgerRpc) {
  const campaignId = uuid(input.campaignId); const actorUserId = uuid(input.actorUserId); const uploadId = uuid(input.uploadId);
  const row = object(await call("service_check_reward_upload_evidence", { p_campaign_id: campaignId, p_actor_user_id: actorUserId,
    p_upload_id: uploadId }, rpc), ["uploadId", "allocationId", "campaignId", "sourceReviewEndsAt", "checkedAt"]);
  demand(row.campaignId === campaignId && row.uploadId === uploadId);
  return { uploadId, campaignId, allocationId: uuid(row.allocationId), sourceReviewEndsAt: integer(row.sourceReviewEndsAt), checkedAt: timestamp(row.checkedAt) };
}
