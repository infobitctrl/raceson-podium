import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { decodeProgrammeActionRequestV3 } from "@raceson/domain/rewards/programme-actions-v3";
import { programmeActionsV3, type ProgrammeActionReaderV3 } from "../../features/rewards/programme-actions-v3-service.js";
import { finalProgrammeActionsV3 } from "../../features/rewards/final-programme-actions-v3-service.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

export async function dispatchProgrammeActionsV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: OrganizerRewardRouteDependencies & { programmeActionReader?: ProgrammeActionReaderV3 }) {
  const historical = /^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/allocation-actions\/([1-4])\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  const path = historical ?? /^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/final-allocation-actions\/([56])\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!path || !["GET", "POST"].includes(req.method ?? "")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const supplied = deps.config(); if (!supplied) return false;
    const chainId = supplied.chainId, identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_programme_action");
    const scope = { chainId, draftId: z.string().uuid().parse(path[1]), slot: Number(path[2]),
      approvalId: z.string().uuid().parse(path[3]), uploadId: z.string().uuid().parse(path[4]) };
    let change;
    if (req.method === "POST") {
      const body = await deps.readJsonBody(req);
      try { change = decodeProgrammeActionRequestV3(body); } catch { throw Error("invalid_reward_programme_action"); }
    }
    deps.sendSuccess(res, await (historical ? programmeActionsV3 : finalProgrammeActionsV3)(identity, scope, change, { rpc: deps.rpc, reader: deps.programmeActionReader }));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code))
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (["reward_planning_not_found", "reward_allocation_upload_not_found"].includes(code))
      deps.sendError(res, 404, code, "Saved allocation is unavailable.");
    else if (["reward_planning_revision_changed", "reward_allocation_not_ready", "reward_programme_lifecycle_conflict", "reward_programme_lifecycle_required",
      "reward_programme_lifecycle_predecessor_required", "reward_programme_lifecycle_attempt_conflict", "reward_programme_lifecycle_job_conflict",
      "reward_round_publication_required", "reward_round_publication_conflict", "reward_final_publication_required",
      "reward_final_review_policy_mismatch", "reward_final_publication_not_ready"].includes(code))
      deps.sendError(res, 409, code, "Reload the saved action before continuing.");
    else if (error instanceof z.ZodError || ["invalid_reward_programme_action", "invalid_reward_final_programme_action"].includes(code))
      deps.sendError(res, 400, "invalid_reward_programme_action", "Check the selected action and gas limits.");
    else deps.sendError(res, 503, "reward_programme_action_unavailable", "Contract action is unavailable. Reconcile the original request before retrying.");
  }
  return true;
}
