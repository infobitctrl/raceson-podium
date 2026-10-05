import {decodeSponsorLaunchView} from "@raceson/domain/rewards/sponsor-launch";
import {decodeSponsorExecutionPlan, decodeSponsorExecutionRecord} from "@raceson/domain/rewards/sponsor-execution";
import {decodeRewardAllocationSourceV3} from "@raceson/domain/rewards/allocation-preview-v3";
import {previewSponsorAllocation, type SponsorSourceBinding} from "@raceson/domain/rewards/sponsor-allocation";
import {canonicalRewardProposalV2 as canonical} from "@raceson/domain/rewards/frozen-proposal-v2";
import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError, copyRewardLedgerDocument as copy, type RewardLedgerRpc} from "./programme-ledger.js";
import {rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentArray as array, rewardDocumentInteger as integer} from "./stored-documents.js";
import {sponsorAllocationDocumentHashV4 as digest} from "./sponsor-allocation-v4.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";
export type SponsorUploadScopeV4 = {chainId: 31337 | 10143; setupId: string; slot: number; approvalId: string};
const check = (v: unknown): void => {if (!v) throw new RewardLedgerStoreError("invalid_sponsor_upload");};
const hash = (v: unknown) => {check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v as string;};
const opaque = (v: unknown) => {check(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) !== 0n); return v as `0x${string}`;};
const safe = new Set(["reward_account_session_required", "reward_setup_not_found", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_sponsor_source_not_ready", "reward_sponsor_approval_not_found", "reward_sponsor_upload_conflict", "reward_sponsor_funding_not_ready", "invalid_sponsor_upload"]);
/** Reconstruct saved economics instead of trusting a stored calculation field. */
export function decodeSponsorAllocationDocumentV4(value: unknown, scope: SponsorUploadScopeV4) {
  const d = object(copy(value), ["schema", "launch", "plan", "binding", "source", "slot", "contextHash", "calculation"]);
  check(d.schema === "raceson-sponsor-allocation-document-v4" && d.slot === scope.slot);
  const l = object(d.launch, ["id", "state", "setup", "configurationHash", "createdAt"]);
  const launch = decodeSponsorLaunchView({setup: l.setup, launch: l}, scope.chainId, scope.setupId).launch!;
  const plan = decodeSponsorExecutionPlan(d.plan), source = decodeRewardAllocationSourceV3(d.source);
  const b = object(d.binding, ["draftId", "catalogueHash", "sourceLeagueId", "sourceSeasonId"]);
  const binding: SponsorSourceBinding = {draftId: uuid(b.draftId), catalogueHash: hash(b.catalogueHash), sourceLeagueId: uuid(b.sourceLeagueId), sourceSeasonId: uuid(b.sourceSeasonId)};
  const calculation = previewSponsorAllocation(launch, plan, binding, source).pots.find(p => p.slot === scope.slot)!;
  check(calculation && calculation.budgetWei > 0n && calculation.groups.every(g => g.hold === null) && canonical(calculation) === canonical(d.calculation));
  return {schema: "raceson-sponsor-allocation-document-v4" as const, launch, plan, binding, source, slot: scope.slot, contextHash: hash(d.contextHash), calculation};
}
export async function sponsorUploadFactsV4(identity: RewardAccountIdentity, scope: SponsorUploadScopeV4,
  write?: {requestId: string; contextHash: string; documentHash: string; package: unknown; funding: unknown}, rpc?: RewardLedgerRpc) {
  check([31337, 10143].includes(scope.chainId) && Number.isInteger(scope.slot) && scope.slot >= 0 && scope.slot <= 5);
  const args = {p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId,
    p_setup_id: uuid(scope.setupId), p_slot: scope.slot, p_approval_id: uuid(scope.approvalId)};
  let result;
  try {result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))(write ? "service_prepare_reward_sponsor_upload_v4" : "service_read_reward_sponsor_upload_v4", {
    ...args, ...(write ? {p_request_id: uuid(write.requestId), p_context_hash: hash(write.contextHash), p_document_hash: hash(write.documentHash),
      p_package_text: canonical(copy(write.package)), p_funding: copy(write.funding)} : {})});}
  catch {throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if (result.error) {const m = (result.error as {message?: unknown}).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable");}
  const decoded = decodeSponsorUploadFactsV4(result.data, scope);
  if (write) check(decoded.prepared?.id === write.requestId && decoded.prepared.actorUserId === identity.userId && canonical(decoded.prepared.package) === canonical(write.package));
  return decoded;
}

/** Pure decoder shared with the independently authenticated controller handoff. */
export function decodeSponsorUploadFactsV4(value: unknown, scope: SponsorUploadScopeV4) {
  const v = object(value, ["approvalId", "contextHash", "documentHash", "document", "current", "execution", "snapshotSalt", "recipients", "prepared"]);
  const document = decodeSponsorAllocationDocumentV4(v.document, scope), documentHash = hash(v.documentHash), contextHash = hash(v.contextHash);
  const execution = decodeSponsorExecutionRecord(v.execution);
  check(v.approvalId === scope.approvalId && typeof v.current === "boolean" && documentHash === digest(document) && contextHash === document.contextHash
    && execution && canonical(execution.plan) === canonical(document.plan));
  const recipients = array(v.recipients, 10000, value => {
    const r = object(value, ["beneficiaryKind", "beneficiaryId", "amountWei", "entitlementId", "opaqueBeneficiaryId", "explanationSalt"]);
    check(r.beneficiaryKind === "athlete" || r.beneficiaryKind === "club");
    return {beneficiaryKind: r.beneficiaryKind as "athlete" | "club", beneficiaryId: uuid(r.beneficiaryId), amountWei: integer(r.amountWei),
      entitlementId: opaque(r.entitlementId), opaqueBeneficiaryId: opaque(r.opaqueBeneficiaryId), explanationSalt: opaque(r.explanationSalt)};
  });
  const prepared = v.prepared === null ? null : (() => {
    const p = object(v.prepared, ["id", "packageHash", "package", "preparedAt", "actorUserId"]);
    check(typeof p.preparedAt === "string" && Number.isFinite(Date.parse(p.preparedAt)) && hash(p.packageHash) === digest(p.package));
    return {id: uuid(p.id), packageHash: hash(p.packageHash), package: copy(p.package), preparedAt: new Date(p.preparedAt as string).toISOString(), actorUserId: uuid(p.actorUserId)};
  })();
  return {approvalId: scope.approvalId, contextHash, documentHash, document, current: v.current as boolean, execution: execution!,
    snapshotSalt: opaque(v.snapshotSalt), recipients, prepared};
}
