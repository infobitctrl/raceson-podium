import { z } from "zod";
import type { RewardAccountIdentity } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { workflowInspectV3, workflowSignV3, workflowJobV3, type WorkflowRuntimeV3 } from "./workflow-v3-service.js";
import type { WorkflowScheduleStoreV3 } from "./workflow-v3-scheduler.js";

export type WorkflowHostV3 = { runtime: WorkflowRuntimeV3; store: WorkflowScheduleStoreV3 };
export const workflowOperationV3 = z.enum(["inspect", "sign", "schedule", "status", "inspect-approval", "approve"]);
export type WorkflowOperationV3 = z.infer<typeof workflowOperationV3>;
export type WorkflowBridgeV3 = { chainId: 31337 | 10143; origin: string;
  dispatch: (actor: RewardAccountIdentity, operation: WorkflowOperationV3, input: unknown) => Promise<unknown> };
export type WorkflowEndpointV3 = WorkflowHostV3 | WorkflowBridgeV3;

/** Shared request contract for in-process and private IPC hosts. Both sides
 * validate the same finite operations; no generic RPC, command or signer API. */
export async function executeWorkflowRequestV3(host: WorkflowEndpointV3, actor: RewardAccountIdentity, action: unknown, body: unknown) {
  const operation = workflowOperationV3.parse(action);
  const input = operation === "sign" || operation === "approve" ? workflowSignV3.parse(body)
    : operation === "schedule" || operation === "status" ? workflowJobV3.parse(body) : workflowInspectV3.parse(body);
  if ("dispatch" in host) return host.dispatch(actor, operation, input);
  if (operation === "inspect-approval") return host.runtime.inspectApproval(actor, input);
  if (operation === "approve") return host.runtime.approve(actor, input);
  if (operation === "inspect") return host.runtime.inspect(actor, input);
  if (operation === "sign") return host.runtime.sign(actor, input);
  const request = workflowJobV3.parse(input);
  const ledger = await host.runtime.job(actor, request, operation);
  const saved = operation === "schedule" ? host.store.enqueue(actor.userId, host.runtime.chainId, request) : host.store.get(request.jobId);
  if (saved) requireReward(saved.userId === actor.userId && saved.chainId === host.runtime.chainId && saved.transactionHash === request.transactionHash
    && canonicalRewardJson(saved.target) === canonicalRewardJson(request.target), "reward_workflow_job_conflict");
  return { schema: "raceson-workflow-schedule-status-v1", target: request.target, ...ledger,
    scheduled: saved !== null, scheduler: saved ? host.store.progress(request.jobId) : null };
}
