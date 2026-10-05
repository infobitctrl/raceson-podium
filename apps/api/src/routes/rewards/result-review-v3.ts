import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { rewardResultReviewV3 } from "@raceson/db/rewards";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const uuid = z.string().uuid().refine(v => v.toLowerCase() === v && v !== "00000000-0000-0000-0000-000000000000");
const update = z.object({ expectedRevision: z.number().int().min(0).max(2147483645), reviewSeconds: z.number().int().min(0).max(2592000) }).strict();

export async function dispatchRewardResultReviewV3(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const match = /^\/api\/v1\/organizer\/rewards\/result-review\/([^/]+)$/.exec(url.pathname);
  if (!match || !["GET", "PATCH"].includes(req.method ?? "")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    if (!deps.config()) return false;
    const identity = await deps.requireIdentity(req);
    const categoryId = uuid.parse(match[1]);
    if ([...url.searchParams].length) throw new Error("invalid_reward_query");
    const change = req.method === "PATCH" ? update.parse(await deps.readJsonBody(req)) : undefined;
    deps.sendSuccess(res, { ...await rewardResultReviewV3(identity, categoryId, change, deps.rpc) });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_result_review_not_found") deps.sendError(res, 404, code, "Race not found or no longer accessible.");
    else if (code === "reward_result_review_revision_changed" || code === "reward_result_review_locked")
      deps.sendError(res, 409, code, "Reload the review policy. Published review windows cannot be changed.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || code === "invalid_reward_result_review")
      deps.sendError(res, 400, "invalid_reward_result_review", "Set an explicit review period between zero and thirty days.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Reward review evidence is temporarily unavailable.");
  }
  return true;
}
