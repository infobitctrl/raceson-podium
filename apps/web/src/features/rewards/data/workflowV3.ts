import { apiRequest } from "@/lib/api";
import { keccak256, toHex } from "viem";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { requireClaimNetwork } from "./athleteClaims";
import { requirePortal, rewardRecord, rewardUuid } from "../model/athleteRewards";

// Task 1 agreement v1.1.0; programme-only projection used by this component.
export type ProgrammeWorkflowTarget = { kind: "programme"; draftId: string; slot: number; approvalId: string; uploadId: string; intentId: string; attemptId: string };
export type WorkflowPlan = { planHash: string; action: string; chainId: number; campaignAddress: string; operatorAddress: string;
  budgetWei: string; allocatedWei: string; fees: { maxGasCostWei: string }; nonce: string };
const hash = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n;
const schedulerOutcomes = ["scheduled", "confirmed", "busy", "held", "pending", "submitted", "awaiting_nonce", "nonce_conflict",
  "unavailable", "broadcast_unknown", "requires_attention", "awaiting_predecessor", "cancelled", "authorization_required"] as const;
export type WorkflowSchedulerProgress = { outcome: typeof schedulerOutcomes[number]; attempts: number; nextAttemptAt: number; updatedAt: number };
function schedulerProgress(value: unknown): WorkflowSchedulerProgress | null {
  if (value === null) return null;
  const r = rewardRecord(value, ["outcome", "attempts", "nextAttemptAt", "updatedAt"]);
  requirePortal(schedulerOutcomes.includes(r.outcome as WorkflowSchedulerProgress["outcome"]));
  for (const key of ["attempts", "nextAttemptAt", "updatedAt"] as const)
    requirePortal(Number.isSafeInteger(r[key]) && Number(r[key]) >= 0);
  return r as WorkflowSchedulerProgress;
}
function scope(target: ProgrammeWorkflowTarget, chainId: number) {
  requireClaimNetwork(chainId); requirePortal(target.kind === "programme" && Number.isInteger(target.slot) && target.slot >= 1 && target.slot <= 6);
  for (const key of ["draftId", "approvalId", "uploadId", "intentId", "attemptId"] as const) requirePortal(rewardUuid(target[key]));
  return { ...target };
}
export async function inspectWorkflow(target: ProgrammeWorkflowTarget, chainId: number, planHash?: string) {
  const fixed = scope(target, chainId); if (planHash !== undefined) requirePortal(hash(planHash));
  const r = rewardRecord(await apiRequest<unknown>({ path: `/v1/organizer/rewards/workflow-v3/${planHash ? "sign" : "inspect"}`,
    method: "POST", cache: "no-store", body: { target: fixed, ...(planHash ? { planHash } : {}) } }), ["schema", "target", "plan", "recorded", "transactionHash"]);
  requireClaimNetwork(chainId);
  requirePortal(r.schema === "raceson-workflow-inspection-v1" && canonicalRewardJson(r.target) === canonicalRewardJson(fixed)
    && typeof r.recorded === "boolean" && (r.recorded ? hash(r.transactionHash) : r.transactionHash === null));
  const p = r.plan as Record<string, unknown>;
  requirePortal(p && p.schema === "raceson-programme-signing-plan-v3" && p.chainId === chainId && hash(p.planHash)
    && ["draftId", "slot", "approvalId", "uploadId", "intentId", "attemptId"].every(k => p[k] === fixed[k as keyof ProgrammeWorkflowTarget]));
  const { planHash: returnedHash, ...body } = p;
  requirePortal(keccak256(toHex(canonicalRewardJson(body))) === returnedHash && (!planHash || returnedHash === planHash));
  requirePortal(["complete_funding", "upload_awards", "stage_allocation", "activate"].includes(String(p.action))
    && typeof p.campaignAddress === "string" && /^0x[0-9a-f]{40}$/.test(p.campaignAddress)
    && typeof p.operatorAddress === "string" && /^0x[0-9a-f]{40}$/.test(p.operatorAddress));
  for (const value of [p.budgetWei, p.allocatedWei, p.nonce, (p.fees as Record<string, unknown>)?.maxGasCostWei])
    requirePortal(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n);
  return { plan: p as unknown as WorkflowPlan, recorded: r.recorded, transactionHash: r.transactionHash as string | null };
}
export async function scheduleWorkflow(target: ProgrammeWorkflowTarget, chainId: number, jobId: string, transactionHash: string, readOnly = false) {
  const fixed = scope(target, chainId); requirePortal(rewardUuid(jobId) && hash(transactionHash));
  const r = rewardRecord(await apiRequest<unknown>({ path: `/v1/organizer/rewards/workflow-v3/${readOnly ? "status" : "schedule"}`,
    method: "POST", cache: "no-store", body: { target: fixed, jobId, transactionHash } }),
    ["schema", "target", "state", "confirmed", "jobId", "transactionHash", "reconciliationRequired", "scheduled", "scheduler"]);
  requireClaimNetwork(chainId);
  requirePortal(r.schema === "raceson-workflow-schedule-status-v1" && canonicalRewardJson(r.target) === canonicalRewardJson(fixed)
    && r.jobId === jobId && r.transactionHash === transactionHash && typeof r.scheduled === "boolean"
    && typeof r.confirmed === "boolean" && ["queued", "leased", "broadcasting", "submitted", "confirmed"].includes(String(r.state))
    && r.confirmed === (r.state === "confirmed") && typeof r.reconciliationRequired === "boolean");
  const scheduler = schedulerProgress(r.scheduler);
  requirePortal(r.scheduled === (scheduler !== null));
  // Worker progress is advisory. Only the fresh, scoped receipt ledger above
  // can set confirmed; a send fence must survive every UI refresh.
  return { state: r.state as "queued" | "leased" | "broadcasting" | "submitted" | "confirmed", confirmed: r.confirmed,
    reconciliationRequired: r.reconciliationRequired, scheduled: r.scheduled, scheduler };
}
