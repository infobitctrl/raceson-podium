import { decodeProgrammeExecutionStatusV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { rewardDocumentUuid as uuid } from "./stored-documents.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import type { AllocationUploadScopeV3 } from "./allocation-upload-v3.js";
export type ProgrammeExecutionScopeV3 = AllocationUploadScopeV3 & { uploadId: string };
const safe = new Set(["reward_account_session_required", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_allocation_upload_not_found", "reward_programme_not_verified"]);
export async function readProgrammeExecutionStatusV3(identity: RewardAccountIdentity, scope: ProgrammeExecutionScopeV3, rpc?: RewardLedgerRpc) {
  if (![31337, 10143].includes(scope.chainId) || !Number.isInteger(scope.slot) || scope.slot < 1 || scope.slot > 6)
    throw new RewardLedgerStoreError("invalid_reward_programme_execution_status");
  const args = { p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId), p_chain_id: scope.chainId,
    p_draft_id: uuid(scope.draftId), p_slot: scope.slot, p_approval_id: uuid(scope.approvalId), p_upload_id: uuid(scope.uploadId) };
  let r;
  try { r = await (rpc ?? ((fn, body) => createAdminSupabaseClient().rpc(fn, body)))("service_read_reward_programme_execution_status_v3", args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const m = (r.error as { message?: unknown }).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable"); }
  try {
    const view = decodeProgrammeExecutionStatusV3(r.data);
    if (view.chainId !== args.p_chain_id || view.draftId !== args.p_draft_id || view.slot !== args.p_slot
      || view.approvalId !== args.p_approval_id || view.uploadId !== args.p_upload_id) throw Error();
    return view;
  } catch { throw new RewardLedgerStoreError("invalid_reward_programme_execution_status"); }
}
