import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getClubRewardAwards, getClubRewardClaims, getClubRewardPaymentStatus } from "../../features/rewards/club-portal-service.js";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";

/** Demo-only read adapter. No body, wallet, chain request or execution method. */
export async function dispatchClubRewardPortalRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: Parameters<typeof dispatchAthleteRewardRoutes>[3]) {
  if (req.method !== "GET") return false;
  const awards = /^\/api\/v1\/athlete\/rewards\/club-awards\/([^/]+)$/.exec(url.pathname);
  const payment = /^\/api\/v1\/athlete\/rewards\/club-claims\/([^/]+)\/payment$/.exec(url.pathname);
  const history = url.pathname === "/api/v1/athlete/rewards/club-claims";
  if (!awards && !payment && !history) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req), options = { ...config, rpc: deps.rpc }, keys = [...url.searchParams.keys()];
    if (keys.length > (payment ? 0 : 1) || keys.some(k => k !== "after")) throw Error("invalid_reward_query");
    const after = url.searchParams.has("after") ? z.string().uuid().parse(url.searchParams.get("after")) : null;
    const data = awards ? await getClubRewardAwards(identity, z.string().uuid().parse(awards[1]), after, options)
      : payment ? await getClubRewardPaymentStatus(identity, z.string().uuid().parse(payment[1]), options)
        : await getClubRewardClaims(identity, after, options);
    deps.sendSuccess(res, data);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in to view your club rewards.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_club_owner_required") deps.sendError(res, 403, code, "Current club ownership is required to view these awards.");
    else if (code === "reward_payment_status_not_found") deps.sendError(res, 404, code, "Claim payment record not found.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || code === "invalid_reward_club_portal_request")
      deps.sendError(res, 400, "invalid_reward_club_portal_request", "Check the club, claim and page selection.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Club rewards are temporarily unavailable.");
  }
  return true;
}
