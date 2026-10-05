import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { finalPublicationChangeV3, finalPublicationV3 } from "../../features/rewards/final-publication-v3-service.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

export async function dispatchFinalPublicationV3(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const path = /^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/final-publication\/([56])\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!path || !["GET", "POST"].includes(req.method ?? "")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_final_publication");
    const scope = { chainId: config.chainId, draftId: z.string().uuid().parse(path[1]), slot: Number(path[2]) as 5 | 6,
      approvalId: z.string().uuid().parse(path[3]), uploadId: z.string().uuid().parse(path[4]) };
    const change = req.method === "POST" ? finalPublicationChangeV3.parse(await deps.readJsonBody(req)) : undefined;
    deps.sendSuccess(res, await finalPublicationV3(identity, scope, change, deps.rpc));
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : e instanceof Error ? e.message : "";
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code))
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (["reward_planning_not_found", "reward_allocation_upload_not_found"].includes(code))
      deps.sendError(res, 404, code, "Saved allocation is unavailable.");
    else if (["reward_planning_revision_changed", "reward_final_publication_conflict", "reward_final_publication_not_ready", "reward_final_review_policy_mismatch"].includes(code))
      deps.sendError(res, 409, code, "Check official results and the approved review policies before continuing.");
    else if (e instanceof z.ZodError || code === "invalid_reward_final_publication")
      deps.sendError(res, 400, "invalid_reward_final_publication", "Check the exact saved publication request.");
    else deps.sendError(res, 503, "reward_final_publication_unavailable", "Publication is unavailable. Preserve the original request for recovery.");
  }
  return true;
}
