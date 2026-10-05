import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { rewardRoundPublicationV3 } from "@raceson/db/rewards";
import { decodeRoundPublicationChangeV3 } from "@raceson/domain/rewards/round-publication-v3";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const uuid = z.string().uuid().refine(v => v !== "00000000-0000-0000-0000-000000000000" && v === v.toLowerCase());
export async function dispatchRoundPublicationV3(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const m = /^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/round-publication\/([1-4])\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!m || !["GET", "POST"].includes(req.method ?? "")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_round_publication");
    const scope = { chainId: config.chainId, draftId: uuid.parse(m[1]), slot: Number(m[2]), approvalId: uuid.parse(m[3]),
      uploadId: uuid.parse(m[4]), packageHash: z.string().regex(/^[0-9a-f]{64}$/).parse(m[5]) };
    const change = req.method === "POST" ? decodeRoundPublicationChangeV3(await deps.readJsonBody(req)) : undefined;
    deps.sendSuccess(res, await rewardRoundPublicationV3(identity, scope, change, deps.rpc));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This request is not allowed.");
    else if (code === "reward_planning_not_found" || code === "reward_allocation_upload_not_found")
      deps.sendError(res, 404, code, "Allocation not found or no longer accessible.");
    else if (["reward_planning_revision_changed", "reward_allocation_not_ready", "reward_round_publication_conflict",
      "reward_round_publication_unsupported", "reward_round_review_pending"].includes(String(code)))
      deps.sendError(res, 409, String(code), "Reload the exact allocation and its platform review status.");
    else if (error instanceof z.ZodError || message === "invalid_reward_round_publication" || code === "invalid_reward_round_publication")
      deps.sendError(res, 400, "invalid_reward_round_publication", "Check the exact review request.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Review status is temporarily unavailable.");
  }
  return true;
}
