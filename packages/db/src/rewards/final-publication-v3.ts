import { decodeFinalPublicationEvidenceV3, finalPublicationBindingV3 } from "@raceson/domain/rewards/final-publication-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import { createAdminSupabaseClient } from "../supabase.js";
import { decodeFinalAllocationUploadV3, type FinalAllocationUploadScopeV3 } from "./final-allocation-v3.js";
import { decodeLeaguePublicationFactsV3 } from "./league-publication-v3.js";
import { decodeProgrammeRegistryV3 } from "./programme-jobs-v3.js";
import { allocationDocumentHashV3 } from "./allocation-approvals-v3.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export type FinalPublicationScopeV3 = FinalAllocationUploadScopeV3 & { uploadId: string };
const check = (v: unknown): void => { if (!v) throw new RewardLedgerStoreError("invalid_reward_final_publication"); };
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v as string)); return v as string; };
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed", "reward_programme_not_verified",
  "reward_allocation_upload_not_found", "reward_final_publication_not_ready", "reward_final_publication_conflict", "invalid_reward_final_publication",
  "reward_final_review_policy_mismatch", "reward_historical_source_missing"]);
/** Private source and aggregate attestation. No caller-supplied clock reaches
 * SQL except the exact server-composed document, rechecked atomically there. */
export async function finalPublicationFactsV3(identity: RewardAccountIdentity, input: FinalPublicationScopeV3,
  change: { requestId: string; contextHash: string; packageHash: string; document: unknown } | undefined, rpc?: RewardLedgerRpc) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) };
  check([31337, 10143].includes(input.chainId) && [5, 6].includes(input.slot));
  const scope = { chainId: input.chainId, draftId: uuid(input.draftId), slot: input.slot, approvalId: uuid(input.approvalId), uploadId: uuid(input.uploadId) };
  const write = change && { requestId: uuid(change.requestId), contextHash: hash(change.contextHash), packageHash: hash(change.packageHash),
    document: decodeFinalPublicationEvidenceV3(copy(change.document)) };
  let r;
  try { r = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))("service_reward_final_publication_v3", {
    p_actor_user_id: actor.userId, p_actor_session_id: actor.sessionId, p_chain_id: scope.chainId, p_draft_id: scope.draftId,
    p_slot: scope.slot, p_approval_id: scope.approvalId, p_upload_id: scope.uploadId, p_request_id: write?.requestId ?? null,
    p_context_hash: write?.contextHash ?? null, p_package_hash: write?.packageHash ?? null, p_document_text: write ? canonical(write.document) : null,
  }); } catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const m = (r.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable"); }
  const raw = object(copy(r.data), ["schema", "source", "registry", "upload", "publication"]);
  check(raw.schema === "raceson-final-publication-private-v3");
  const source = decodeLeaguePublicationFactsV3(raw.source, actor, { ...scope, requestId: null });
  const registry = decodeProgrammeRegistryV3(raw.registry, scope), upload = decodeFinalAllocationUploadV3(raw.upload, scope);
  check(registry.context.intent?.createdByUserId === actor.userId && registry.registry && upload.prepared?.id === scope.uploadId);
  let publication = null;
  if (raw.publication !== null) {
    const p = object(raw.publication, ["id", "uploadId", "contextHash", "packageHash", "evidenceHash", "document", "recordedAt", "recordedByUserId"]);
    const document = decodeFinalPublicationEvidenceV3(p.document), evidenceHash = hash(p.evidenceHash);
    check(p.uploadId === scope.uploadId && document.uploadId === scope.uploadId && document.approvalId === scope.approvalId
      && document.chainId === scope.chainId && document.draftId === scope.draftId && document.slot === scope.slot
      && document.documentHash === upload.documentHash && document.contextHash === p.contextHash && document.packageHash === p.packageHash
      && p.packageHash === upload.prepared!.packageHash && canonical(document.sourceReview) === canonical(upload.document.sourceReview)
      && document.reviewPeriod === String(upload.document.binding!.reviewSeconds)
      && document.finalRoundReviewPeriod === String(registry.context.intent!.terms.reviewPeriods[4])
      && allocationDocumentHashV3(document) === evidenceHash && p.recordedByUserId === actor.userId
      && typeof p.recordedAt === "string" && Number.isFinite(Date.parse(p.recordedAt)));
    publication = { id: uuid(p.id), uploadId: scope.uploadId, contextHash: hash(p.contextHash), packageHash: hash(p.packageHash), evidenceHash, document,
      recordedAt: new Date(p.recordedAt as string).toISOString(), recordedByUserId: actor.userId,
      binding: finalPublicationBindingV3(uuid(p.id), evidenceHash, document) };
  }
  if (write) check(publication?.id === write.requestId && publication.contextHash === write.contextHash && publication.packageHash === write.packageHash
    && canonical(publication.document) === canonical(write.document));
  return { source, registry, upload, publication };
}
