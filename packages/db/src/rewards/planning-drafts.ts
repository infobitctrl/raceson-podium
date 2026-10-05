import { decodeProgrammeSources, decodeCreateProgramme } from "@raceson/domain/rewards/programme-creation";
import { decodeRewardProgrammeDraftV2, decodeSavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeStoredRewardSnapshot } from "@raceson/domain/rewards/published-preview-v2";
import { requireHistoricalCatalogueV3 } from "@raceson/domain/rewards/historical-catalogue-v3";
import { decodeRewardMappingWorkspaceV2, validateRewardSourceMappingV2, type RewardMappingWorkspaceV2 } from "@raceson/domain/rewards/source-mapping-v2";
import { createAdminSupabaseClient } from "../supabase.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";

const safe = new Set(["reward_programme_exists","reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed", "invalid_reward_planning_request"]);
async function call(method: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result;
  try { result = await (rpc ?? ((name, input) => createAdminSupabaseClient().rpc(name, input)))(method, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = (result.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_unavailable");
  }
  return result.data;
}
const scope = (identity: RewardAccountIdentity, chainId: 31337 | 10143) => ({
  p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId,
});
export async function listRewardPlanningDrafts(identity: RewardAccountIdentity, chainId: 31337 | 10143, rpc?: RewardLedgerRpc) {
  const raw = await call("service_list_reward_planning_drafts", scope(identity, chainId), rpc);
  if (!Array.isArray(raw) || raw.length > 100) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  return raw.map(value => checked(value, chainId));
}
function checked(raw: unknown, chainId: number, draftId?: string) {
  const d = decodeSavedRewardPlanningDraft(raw);
  if (d.chainId !== chainId || (draftId && d.draftId !== draftId)) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  return d;
}
export async function readRewardPlanningDraft(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string, rpc?: RewardLedgerRpc) {
  return checked(await call("service_read_reward_planning_draft", { ...scope(identity, chainId), p_draft_id: draftId }, rpc), chainId, draftId);
}
export async function saveRewardPlanningDraft(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string,
  revision: number, rules: unknown, rpc?: RewardLedgerRpc) {
  const validated = decodeRewardProgrammeDraftV2(rules);
  return checked(await call("service_save_reward_planning_draft", { ...scope(identity, chainId), p_draft_id: draftId,
    p_expected_revision: revision, p_rules: validated }, rpc), chainId, draftId);
}
function mappingReply(raw: unknown, draftId: string) {
  const workspace = decodeRewardMappingWorkspaceV2(raw);
  if (workspace.draftId !== draftId) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  return workspace;
}
export async function readRewardSourceMappingV2(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string, rpc?: RewardLedgerRpc) {
  return mappingReply(await call("service_read_reward_mapping_v2", { ...scope(identity, chainId), p_draft_id: draftId }, rpc), draftId);
}
export async function saveRewardSourceMappingV2(identity: RewardAccountIdentity, chainId: 31337 | 10143, current: RewardMappingWorkspaceV2,
  expectedRevision: number, expectedRulesRevision: number, catalogueHash: string, mapping: unknown, rpc?: RewardLedgerRpc) {
  // Do not replace client revisions with the newer read. SQL repeats all CAS
  // checks under the draft lock; this read supplies only authoritative IDs.
  if (expectedRevision !== current.revision || expectedRulesRevision !== current.rulesRevision || catalogueHash !== current.catalogueHash)
    throw new RewardLedgerStoreError("reward_planning_revision_changed");
  const validated = validateRewardSourceMappingV2(mapping, current.catalogue);
  return mappingReply(await call("service_save_reward_mapping_v2", { ...scope(identity, chainId), p_draft_id: current.draftId,
    p_expected_revision: expectedRevision, p_expected_rules_revision: expectedRulesRevision, p_catalogue_hash: catalogueHash, p_mapping: validated }, rpc), current.draftId);
}

export async function readRewardPublishedPreviewV2(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string, rpc?: RewardLedgerRpc) {
  const raw = await call("service_read_reward_published_preview_v2", { ...scope(identity, chainId), p_draft_id: draftId }, rpc);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  const r = raw as Record<string, unknown>, record = checked(r.record, chainId, draftId), workspace = mappingReply(r.workspace, draftId);
  if (Object.keys(r).length !== 4 || workspace.rulesRevision !== record.revision) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  const snapshot = r.snapshot === null ? null : decodeStoredRewardSnapshot(r.snapshot);
  if (snapshot ? typeof r.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(r.sourceHash) : r.sourceHash !== null)
    throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  // Compare normalized catalogues, not PostgreSQL/JavaScript object key order.
  if (snapshot) requireHistoricalCatalogueV3(snapshot, workspace.catalogue);
  return { record, workspace, snapshot, sourceHash: r.sourceHash as string | null };
}

export async function rewardProgrammeCreation(identity: RewardAccountIdentity, chainId: 31337 | 10143, input?:unknown, rpc?:RewardLedgerRpc) {
 const change=input===undefined?undefined:decodeCreateProgramme(input);
 const result=await call("service_reward_programme_creation",{...scope(identity,chainId),p_season_id:change?.seasonId??null,p_draft_id:change?.draftId??null,p_budget_mon:change?.budgetMon??null},rpc);
 if(!change)return decodeProgrammeSources(result);
 const record=checked(result,chainId,change.draftId);
 if(record.seasonId!==change.seasonId)throw new RewardLedgerStoreError("invalid_saved_reward_draft");
 return record;
}
