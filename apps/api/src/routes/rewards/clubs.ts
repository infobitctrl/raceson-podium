import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { dispatchClubRewardPortalRoutes } from "./club-portal.js";
import { dispatchClubClaimActionRoutes } from "./club-claims.js";
import { nominateClubRewardTreasury, getClubRewardTreasury, getClubRewardTreasuries, withdrawClubRewardTreasury, getRewardOwnedClubs } from "../../features/rewards/club-treasury-service.js";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value as `0x${string}`);
const nomination = z.object({ clubId: z.string().uuid(), safeAddress: address, singletonAddress: address,
  fallbackHandlerAddress: address, owners: z.array(address).length(3), idempotencyKey: z.string().min(8).max(128) }).strict();
const invalid = new Set(["invalid_reward_club_treasury_request", "reward_club_invalid_owners",
  "reward_club_three_owners_required", "reward_club_safe_address_mismatch", "invalid_reward_address"]);
/** Demo-only, account-private nomination/history. No chain read, operator
 * approval, account linking, wallet provisioning or payment operation. */
export async function dispatchClubRewardRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: Parameters<typeof dispatchAthleteRewardRoutes>[3]) {
  if (url.pathname.startsWith("/api/v1/athlete/") && await dispatchClubClaimActionRoutes(req, res, url, deps)) return true;
  if (await dispatchClubRewardPortalRoutes(req, res, url, deps)) return true;
  const base = "/api/v1/athlete/rewards/club-treasury-requests", path = /^\/api\/v1\/athlete\/rewards\/club-treasury-requests\/([^/]+)(\/withdraw)?$/.exec(url.pathname);
  const action = url.pathname === "/api/v1/athlete/rewards/owned-clubs" && req.method === "GET" ? "clubs"
    : url.pathname === base && req.method === "POST" ? "nominate" : url.pathname === base && req.method === "GET" ? "list"
    : path && req.method === "GET" && !path[2] ? "read" : path?.[2] === "/withdraw" && req.method === "POST" ? "withdraw" : null;
  if (!action) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req), options = { ...config, rpc: deps.resolveRpc?.(identity)??deps.rpc };
    const keys = [...url.searchParams.keys()];
    const paginated = action === "list" || action === "clubs";
    if ((!paginated && keys.length) || (paginated && (keys.length > 1 || keys.some(key => key !== "after")))) throw Error("invalid_reward_query");
    if (action === "nominate") deps.sendSuccess(res, await nominateClubRewardTreasury(identity, nomination.parse(await deps.readJsonBody(req)), options));
    else if (action === "list" || action === "clubs") {
      const after = url.searchParams.has("after") ? z.string().uuid().parse(url.searchParams.get("after")) : null;
      deps.sendSuccess(res, await (action === "clubs" ? getRewardOwnedClubs : getClubRewardTreasuries)(identity, after, options));
    } else {
      const id = z.string().uuid().parse(path?.[1]);
      if (action === "withdraw") {
        z.object({}).strict().parse(await deps.readJsonBody(req));
        deps.sendSuccess(res, await withdrawClubRewardTreasury(identity, id, options));
      } else deps.sendSuccess(res, await getClubRewardTreasury(identity, id, options));
    }
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in to view your treasury requests.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_club_owner_required" || code === "reward_demo_account_required") deps.sendError(res, 403, "reward_club_owner_required", "Current club ownership is required to nominate a treasury.");
    else if (code === "reward_club_treasury_not_found") deps.sendError(res, 404, code, "Treasury request not found.");
    else if (code === "reward_club_treasury_withdraw_first" || code === "reward_ledger_idempotency_conflict")
      deps.sendError(res, 409, code, "Review your existing treasury request before submitting another.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || (code && invalid.has(code)))
      deps.sendError(res, 400, "invalid_reward_club_treasury_request", "Check the proposed treasury and its three owner addresses.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Treasury requests are temporarily unavailable.");
  }
  return true;
}
