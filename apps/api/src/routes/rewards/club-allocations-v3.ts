import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { clubAllocationCursorV3 } from "@raceson/domain/rewards/club-allocations-v3";
import { getClubAllocationsV3 } from "../../features/rewards/club-allocations-v3-service.js";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";

/** Demo-only current-owner read. No signing, chain access or mutable endpoint. */
export async function dispatchClubAllocationsV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Parameters<typeof dispatchAthleteRewardRoutes>[3]) {
  const match = /^\/api\/v1\/club\/rewards\/clubs\/([^/]+)\/allocations-v3$/.exec(url.pathname);
  if (req.method !== "GET" || !match) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req), keys = [...url.searchParams.keys()];
    const after = url.searchParams.has("after") ? url.searchParams.get("after") : null;
    if (keys.length > 1 || keys.some(k => k !== "after") || (after !== null && !clubAllocationCursorV3(after)))
      throw Error("invalid_reward_club_allocation_query");
    const clubId = z.string().uuid().parse(match[1]);
    deps.sendSuccess(res, await getClubAllocationsV3(identity, clubId, after, { ...config, rpc: deps.rpc }));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in to view your club rewards.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_club_owner_required") deps.sendError(res, 403, code, "Current club ownership is required to view these awards.");
    else if (error instanceof z.ZodError || message === "invalid_reward_club_allocation_query" || code === "invalid_reward_club_allocation_query")
      deps.sendError(res, 400, "invalid_reward_club_allocation_query", "Check the club and page selection.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Club rewards are temporarily unavailable.");
  }
  return true;
}
