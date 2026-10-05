import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { organizerClubCursorV3 } from "@raceson/domain/rewards/organizer-club-awards-v3";
import { listOrganizerClubAwardsV3 } from "@raceson/db/rewards";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
/** Private demo operator-only discovery; no read carries execution authority. */
export async function dispatchOrganizerClubAwardsV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Parameters<typeof dispatchAthleteRewardRoutes>[3]) {
  const m = /^\/api\/v1\/organizer\/rewards\/uploads\/([^/]+)\/club-awards-v3$/.exec(url.pathname);
  if (!m || req.method !== "GET") return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req), uploadId = z.string().uuid().parse(m[1]);
    const keys = [...url.searchParams.keys()], after = url.searchParams.has("after") ? url.searchParams.get("after") : null;
    if (keys.length > 1 || keys.some(k => k !== "after") || after !== null && !organizerClubCursorV3(after)) throw Error("invalid_reward_organizer_club_query");
    deps.sendSuccess(res, await listOrganizerClubAwardsV3(identity, { chainId: config.chainId, uploadId, after }, deps.rpc));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["reward_account_session_required","Unauthorized","Missing bearer token"].includes(code)) deps.sendError(res,401,"reward_auth_required","Sign in to the isolated rewards demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res,403,"forbidden","This browser request is not allowed.");
    else if (code === "reward_club_readiness_scope_required") deps.sendError(res,404,code,"Club awards not found for this operator and upload.");
    else if (error instanceof z.ZodError || code === "invalid_reward_organizer_club_query") deps.sendError(res,400,"invalid_reward_organizer_club_query","Check the selected upload and page.");
    else deps.sendError(res,503,"reward_service_unavailable","Club awards are temporarily unavailable.");
  }
  return true;
}
