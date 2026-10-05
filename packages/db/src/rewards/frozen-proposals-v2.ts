import { buildRewardProposalV2, canonicalRewardProposalV2, decodeFrozenRewardProposalV2 } from "@raceson/domain/rewards/frozen-proposal-v2";
import { readRewardPublishedPreviewV2 } from "./planning-drafts.js";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, copyRewardLedgerDocument, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type RewardProposalExpectationV2 = { rulesRevision: number; mappingRevision: number; catalogueHash: string; sourceHash: string };
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let reply;
  try { reply = await (rpc ?? ((method, input) => createAdminSupabaseClient().rpc(method, input)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (reply.error) {
    const message = (reply.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof message === "string" && ["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed", "invalid_reward_planning_request"].includes(message) ? message : "reward_ledger_unavailable");
  }
  return reply.data;
}
export async function rewardFrozenProposalsV2(identity: RewardAccountIdentity, chainId: 31337 | 10143, draftId: string, slot: number,
  expectation?: RewardProposalExpectationV2, rpc?: RewardLedgerRpc) {
  const current = await readRewardPublishedPreviewV2(identity, chainId, draftId, rpc);
  if (!current.snapshot || current.snapshot.version !== 2 || !current.sourceHash) throw new RewardLedgerStoreError("invalid_reward_planning_request");
  const snapshot = current.snapshot;
  const args = { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_chain_id: chainId, p_draft_id: draftId, p_slot: slot };
  const scope = { ...current.record, sourceHash: current.sourceHash, slot };
  if (expectation) {
    if (expectation.rulesRevision !== current.record.revision || expectation.mappingRevision !== current.workspace.revision
      || expectation.catalogueHash !== current.workspace.catalogueHash || expectation.sourceHash !== current.sourceHash)
      throw new RewardLedgerStoreError("reward_planning_revision_changed");
    const document = buildRewardProposalV2(current.record, current.workspace, current.snapshot, current.sourceHash, slot);
    const raw = await call("service_freeze_reward_proposal_v2", { ...args, p_rules_revision: expectation.rulesRevision,
      p_mapping_revision: expectation.mappingRevision, p_catalogue_hash: expectation.catalogueHash, p_source_hash: expectation.sourceHash,
      p_calculation: copyRewardLedgerDocument(document.calculation) }, rpc);
    const saved = decodeFrozenRewardProposalV2(raw, current.snapshot, scope);
    if (canonicalRewardProposalV2(saved.document) !== canonicalRewardProposalV2(document)) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
    return [saved];
  }
  const raw = await call("service_list_reward_proposals_v2", args, rpc);
  if (!Array.isArray(raw) || raw.length > 10) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  const items = raw.map(value => decodeFrozenRewardProposalV2(value, snapshot, scope));
  if (items.some((item, i) => i > 0 && item.revision >= items[i - 1]!.revision)) throw new RewardLedgerStoreError("invalid_saved_reward_draft");
  return items;
}
