import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
import type { RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { finalAllocationViewV3 } from "../../features/rewards/final-allocation-v3-service.js";

/** Read-only preparation; historical approval routes deliberately stay 1–4. */
export async function dispatchFinalAllocationV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Parameters<typeof dispatchAthleteRewardRoutes>[3] & { programmeFundingReader?: RewardProgrammeReaderV3 }) {
  const m = /^\/api\/v1\/organizer\/rewards\/drafts\/([^/]+)\/final-allocation\/([56])$/.exec(url.pathname);
  if (!m || req.method !== "GET") return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_final_allocation_request");
    const scope = { chainId: config.chainId, draftId: z.string().uuid().parse(m[1]), slot: Number(m[2]) as 5 | 6 };
    deps.sendSuccess(res, await finalAllocationViewV3(identity, scope, { rpc: deps.rpc, reader: deps.programmeFundingReader }));
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : e instanceof Error ? e.message : "";
    if (["Unauthorized", "Missing bearer token", "reward_account_session_required"].includes(code))
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_planning_not_found") deps.sendError(res, 404, code, "Draft not found or no longer accessible.");
    else if (["reward_planning_revision_changed", "reward_final_allocation_source_not_ready", "reward_league_publication_not_ready",
      "reward_historical_source_missing", "reward_programme_approval_required", "reward_programme_binding_mismatch"].includes(code))
      deps.sendError(res, 409, code, "Review the current official source, scoring policy and programme binding before preparing prizes.");
    else if (e instanceof z.ZodError || code === "invalid_reward_final_allocation_request")
      deps.sendError(res, 400, "invalid_reward_final_allocation_request", "Choose round 5 or the final league without additional inputs.");
    else deps.sendError(res, 503, "reward_final_allocation_unavailable", "Final prize preparation is temporarily unavailable.");
  }
  return true;
}
