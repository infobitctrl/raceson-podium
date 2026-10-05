import { decodeAllocationDocumentV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { canonicalRewardProposalV2 } from "@raceson/domain/rewards/frozen-proposal-v2";
import { createAdminSupabaseClient } from "../supabase.js";
import { allocationDocumentHashV3, type AllocationApprovalScopeV3 } from "./allocation-approvals-v3.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentArray as array,
  rewardDocumentInteger as integer } from "./stored-documents.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type AllocationUploadScopeV3 = Omit<AllocationApprovalScopeV3, "requestId"> & { approvalId: string };
export type AllocationUploadChangeV3 = { requestId: string; contextHash: string; documentHash: string };
const check = (value: unknown): void => { if (!value) throw new RewardLedgerStoreError("invalid_reward_allocation_upload"); };
function hash(value: unknown): string { check(typeof value === "string" && /^[0-9a-f]{64}$/.test(value as string)); return value as string; }
function opaque(value: unknown): `0x${string}` {
  check(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value as string) && BigInt(value as string) !== 0n);
  return value as `0x${string}`;
}
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_allocation_upload_not_found", "reward_allocation_upload_conflict", "invalid_reward_allocation_upload", "reward_allocation_not_ready"]);

/** SERVER ONLY: private salts/source identity mappings. Never serialize this
 * result into an HTTP response, a log, or a legacy V1 entitlement table. */
async function invoke(identity: RewardAccountIdentity, scope: AllocationUploadScopeV3,
  change?: AllocationUploadChangeV3 & { package: unknown }, rpc?: RewardLedgerRpc) {
  check(scope.chainId === 31337 || scope.chainId === 10143);
  check(Number.isInteger(scope.slot) && scope.slot >= 1 && scope.slot <= 4);
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId,
    p_draft_id: uuid(scope.draftId), p_slot: scope.slot, p_approval_id: uuid(scope.approvalId) };
  const write = change && { p_request_id: uuid(change.requestId), p_context_hash: hash(change.contextHash),
    p_document_hash: hash(change.documentHash), p_package_text: canonicalRewardProposalV2(copy(change.package)) };
  let result;
  try { result = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))(change
    ? "service_prepare_reward_allocation_upload_v3" : "service_read_reward_allocation_upload_v3", { ...args, ...write }); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable");
  }
  const decoded = decodeAllocationUploadV3(result.data, { chainId: args.p_chain_id, draftId: args.p_draft_id,
    slot: args.p_slot, approvalId: args.p_approval_id });
  if (write) check(decoded.prepared?.id === write.p_request_id && decoded.prepared.preparedByUserId === args.p_actor_user_id
    && decoded.prepared.contextHash === write.p_context_hash && canonicalRewardProposalV2(decoded.prepared.package) === write.p_package_text);
  return decoded;
}
/** Private transport decoder shared by the persisted V3 lifecycle reader. */
export function decodeAllocationUploadV3(value: unknown, scope: AllocationUploadScopeV3) {
  return decodeAllocationUploadWithDocumentV3(value, scope, decodeAllocationDocumentV3, [1, 2, 3, 4]);
}
/** Shared private envelope; the caller selects a strict versioned document
 * decoder and its permitted slots. Historical callers cannot widen themselves. */
export function decodeAllocationUploadWithDocumentV3<D extends {record:{draftId:string;chainId:number};slot:number;binding:unknown}>(
  value: unknown, scope: AllocationUploadScopeV3, decodeDocument:(value:unknown)=>D, slots:readonly number[]) {
  check(scope.chainId === 31337 || scope.chainId === 10143);
  check(Number.isInteger(scope.slot) && slots.includes(scope.slot));
  const args = { p_draft_id: uuid(scope.draftId), p_chain_id: scope.chainId, p_slot: scope.slot, p_approval_id: uuid(scope.approvalId) };
  const r = object(value, ["schema", "approvalId", "contextHash", "current", "documentHash", "document", "snapshotSalt", "recipients", "prepared"]);
  check(r.schema === "raceson-allocation-upload-private-v3" && r.approvalId === args.p_approval_id && typeof r.current === "boolean");
  const document = decodeDocument(r.document), documentHash = hash(r.documentHash);
  check(document.record.draftId === args.p_draft_id && document.record.chainId === args.p_chain_id
    && document.slot === args.p_slot && document.binding && allocationDocumentHashV3(document) === documentHash);
  const recipients = array(r.recipients, 10000, value => {
    const row = object(value, ["beneficiaryKind", "sourceBeneficiaryId", "amountWei", "entitlementId", "opaqueBeneficiaryId", "explanationSalt"]);
    check(row.beneficiaryKind === "athlete" || row.beneficiaryKind === "club");
    const amountWei = integer(row.amountWei); check(amountWei > 0n);
    return { beneficiaryKind: row.beneficiaryKind as "athlete" | "club", sourceBeneficiaryId: uuid(row.sourceBeneficiaryId), amountWei,
      entitlementId: opaque(row.entitlementId), opaqueBeneficiaryId: opaque(row.opaqueBeneficiaryId), explanationSalt: opaque(row.explanationSalt) };
  });
  let prepared = null;
  if (r.prepared !== null) {
    const p = object(r.prepared, ["id", "contextHash", "documentHash", "packageHash", "package", "preparedAt", "preparedByUserId"]);
    check(p.documentHash === documentHash && allocationDocumentHashV3(p.package) === p.packageHash
      && typeof p.preparedAt === "string" && Number.isFinite(Date.parse(p.preparedAt)));
    prepared = { id: uuid(p.id), contextHash: hash(p.contextHash), documentHash, packageHash: hash(p.packageHash),
      package: copy(p.package), preparedAt: p.preparedAt as string, preparedByUserId: uuid(p.preparedByUserId) };
  }
  return { approvalId: args.p_approval_id, contextHash: hash(r.contextHash), current: r.current as boolean,
    documentHash, document, snapshotSalt: opaque(r.snapshotSalt), recipients, prepared };
}
export const readAllocationUploadV3 = (identity: RewardAccountIdentity, scope: AllocationUploadScopeV3, rpc?: RewardLedgerRpc) => invoke(identity, scope, undefined, rpc);
export const storeAllocationUploadV3 = (identity: RewardAccountIdentity, scope: AllocationUploadScopeV3,
  change: AllocationUploadChangeV3 & { package: unknown }, rpc?: RewardLedgerRpc) => invoke(identity, scope, change, rpc);
