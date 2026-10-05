import {createHash} from "node:crypto";
import {decodeSponsorLaunchView} from "@raceson/domain/rewards/sponsor-launch";
import {decodeSponsorExecutionRecord} from "@raceson/domain/rewards/sponsor-execution";
import {canonicalRewardProposalV2} from "@raceson/domain/rewards/frozen-proposal-v2";
import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError, type RewardLedgerRpc} from "./programme-ledger.js";
import {rewardDocumentObject as object, rewardDocumentUuid as uuid} from "./stored-documents.js";
import type {RewardAccountIdentity} from "./athlete-wallets.js";
export type SponsorAllocationScopeV4 = {chainId: 31337 | 10143; setupId: string; slot: number; requestId?: string};
export const sponsorAllocationDocumentHashV4 = (v: unknown) => createHash("sha256").update(canonicalRewardProposalV2(v)).digest("hex");
function check(v: unknown): asserts v {if (!v) throw new RewardLedgerStoreError("invalid_sponsor_allocation");}
const hash = (v: unknown) => {check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v;};
const safe = new Set(["reward_account_session_required", "reward_setup_not_found", "reward_planning_not_found", "reward_planning_revision_changed",
  "reward_sponsor_source_not_ready", "reward_sponsor_approval_conflict", "reward_review_issue_open", "invalid_sponsor_allocation", "reward_historical_source_missing"]);
/** Service-only source facts. Never return this private transport directly through HTTP. */
export async function sponsorAllocationFactsV4(identity: RewardAccountIdentity, scope: SponsorAllocationScopeV4,
  write?: {expectedApprovalId: string | null; contextHash: string; document: unknown; decision: "approved" | "held"}, rpc?: RewardLedgerRpc) {
  check([31337, 10143].includes(scope.chainId) && Number.isInteger(scope.slot) && scope.slot >= 0 && scope.slot <= 5);
  const actor = {userId: uuid(identity.userId), sessionId: uuid(identity.sessionId)};
  const args = {p_actor_user_id: actor.userId, p_actor_session_id: actor.sessionId, p_chain_id: scope.chainId,
    p_setup_id: uuid(scope.setupId), p_slot: scope.slot, p_request_id: scope.requestId ? uuid(scope.requestId) : null};
  if (write) check(args.p_request_id && ["approved", "held"].includes(write.decision));
  let result;
  try {result = await (rpc ?? ((name, args) => createAdminSupabaseClient().rpc(name, args)))(write ? "service_review_reward_sponsor_allocation_v4" : "service_read_reward_sponsor_allocation_v4",
    {...args, ...(write ? {p_expected_approval_id: write.expectedApprovalId === null ? null : uuid(write.expectedApprovalId),
      p_context_hash: hash(write.contextHash), p_document_text: canonicalRewardProposalV2(write.document), p_decision: write.decision} : {})});}
  catch {throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if (result.error) {const m = (result.error as {message?: unknown}).message;
    throw new RewardLedgerStoreError(typeof m === "string" && safe.has(m) ? m : "reward_ledger_unavailable");}
  const v = object(result.data, ["launch", "execution", "sourceFacts", "contextHash", "approval", "recorded"]);
  const rawLaunch = object(v.launch, ["id", "setup", "configurationHash", "createdAt", "state"]);
  const launch = decodeSponsorLaunchView({setup: rawLaunch.setup, launch: v.launch}, scope.chainId, scope.setupId).launch!;
  const execution = decodeSponsorExecutionRecord(v.execution), contextHash = hash(v.contextHash);
  check(execution && execution.plan.chainId === scope.chainId && execution.plan.launchId === launch.id
    && execution.plan.setupRevision === launch.setup.revision && execution.plan.configurationHash === launch.configurationHash);
  const approval = (value: unknown) => {
    if (value === null) return null;
    const r = object(value, ["id", "previousApprovalId", "contextHash", "documentHash", "decision", "actorUserId", "createdAt", "current"]);
    check(["approved", "held"].includes(String(r.decision)) && r.current === (r.contextHash === contextHash)
      && typeof r.createdAt === "string" && Number.isFinite(Date.parse(r.createdAt)));
    return {id: uuid(r.id), previousApprovalId: r.previousApprovalId === null ? null : uuid(r.previousApprovalId), contextHash: hash(r.contextHash),
      documentHash: hash(r.documentHash), decision: r.decision as "approved" | "held", actorUserId: uuid(r.actorUserId),
      createdAt: new Date(r.createdAt).toISOString(), current: r.current as boolean};
  };
  const latest = approval(v.approval), recorded = approval(v.recorded);
  if (recorded) check(recorded.id === scope.requestId && recorded.actorUserId === actor.userId);
  if (write) check(recorded && recorded.documentHash === sponsorAllocationDocumentHashV4(write.document) && recorded.contextHash === write.contextHash
    && recorded.decision === write.decision && recorded.previousApprovalId === write.expectedApprovalId);
  return {launch, execution, sourceFacts: v.sourceFacts, contextHash, approval: latest, recorded};
}
