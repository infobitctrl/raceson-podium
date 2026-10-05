import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { requireReward } from "@raceson/domain/rewards";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
import { executeWorkflowRequestV3, type WorkflowEndpointV3 } from "../../features/rewards/workflow-v3-request.js";
import { readWorkflowStatusV3 } from "../../features/rewards/workflow-status-v3-service.js";
export type { WorkflowHostV3, WorkflowEndpointV3 } from "../../features/rewards/workflow-v3-request.js";
export async function dispatchWorkflowV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: OrganizerRewardRouteDependencies, host?: WorkflowEndpointV3) {
  const action = /^\/api\/v1\/organizer\/rewards\/workflow-v3\/(inspect|sign|schedule|status|inspect-approval|approve)$/.exec(url.pathname);
  const status = /^\/api\/v1\/(athlete|organizer)\/rewards\/uploads\/([^/]+)\/destinations\/([^/]+)\/awards\/([^/]+)\/claims\/([^/]+)\/workflow-status$/.exec(url.pathname);
  if (!(action && req.method === "POST") && !(status && req.method === "GET")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const actor = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_workflow_request");
    if (status) {
      const scope = { chainId: config.chainId, uploadId: z.string().uuid().parse(status[2]), destinationId: z.string().uuid().parse(status[3]),
        entitlementId: z.string().regex(/^0x[0-9a-f]{64}$/).parse(status[4]), claimId: z.string().uuid().parse(status[5]),
        role: status[1] === "athlete" ? "recipient" as const : "operator" as const };
      deps.sendSuccess(res, await readWorkflowStatusV3(actor, scope, { rpc: deps.rpc })); return true;
    }
    requireReward(host, "reward_workflow_not_configured");
    const endpoint = "dispatch" in host ? host : host.runtime;
    requireReward(endpoint.chainId === config.chainId && endpoint.origin === config.origin, "reward_workflow_not_configured");
    deps.sendSuccess(res, z.record(z.unknown()).parse(await executeWorkflowRequestV3(host, actor, action![1], await deps.readJsonBody(req))));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["Unauthorized", "Missing bearer token", "reward_account_session_required"].includes(code))
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated rewards demo.");
    else if (["Untrusted browser origin", "forbidden", "reward_workflow_authority_required"].includes(code))
      deps.sendError(res, 403, "forbidden", "This action requires current scoped operator authority.");
    else if (["reward_claim_scope_required", "reward_readiness_scope_required", "reward_payment_scope_required", "reward_planning_not_found"].includes(code))
      deps.sendError(res, 404, "reward_workflow_not_found", "The selected reward is unavailable.");
    else if (error instanceof z.ZodError || code === "invalid_reward_workflow_request")
      deps.sendError(res, 400, "invalid_reward_workflow_request", "Use the exact saved reward action.");
    else if (["reward_workflow_job_conflict", "reward_workflow_status_changed", "reward_programme_signing_plan_changed", "reward_payment_signing_plan_changed",
      "reward_allocation_not_ready", "reward_recipient_consent_required", "reward_claim_readiness_required", "reward_payment_approvals_required", "reward_claim_already_paid",
      "reward_payment_conflict", "reward_claim_window_unavailable", "reward_programme_lifecycle_attempt_conflict"].includes(code))
      deps.sendError(res, 409, code, "Reload the original action and its current holds before continuing.");
    else deps.sendError(res, 503, code === "reward_workflow_not_configured" ? code : "reward_workflow_unavailable",
      "Workflow status is unavailable. Reconcile the original request before retrying.");
  }
  return true;
}
