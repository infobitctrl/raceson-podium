import type {IncomingMessage, ServerResponse} from "node:http";
import {z} from "zod";
import {rewardSponsorLaunch} from "@raceson/db/rewards";
import type {OrganizerRewardRouteDependencies} from "./organizer.js";

const uuid = z.string().uuid().refine(v => v === v.toLowerCase() && v !== "00000000-0000-0000-0000-000000000000");
const command = z.object({requestId: uuid, expectedRevision: z.number().int().min(1).max(2147483645)}).strict();
export async function dispatchSponsorLaunch(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const match = /^\/api\/v1\/rewards\/distribution-setups\/([^/]+)\/launch$/.exec(url.pathname);
  if (!match) return false;
  deps.applyPrivateSessionHeaders(res);
  if (req.method !== "GET" && req.method !== "POST") {res.setHeader("Allow", "GET, POST"); deps.sendError(res, 405, "method_not_allowed", "Unsupported method."); return true;}
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_sponsor_launch");
    const id = uuid.parse(match[1]);
    const change = req.method === "POST" ? command.parse(await deps.readJsonBody(req)) : undefined;
    deps.sendSuccess(res, await rewardSponsorLaunch(identity, config.chainId, id, change, deps.rpc));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code)) deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_setup_not_found") deps.sendError(res, 404, code, "Campaign not found.");
    else if (code === "reward_launch_sources_required") deps.sendError(res, 409, code, "Connect the official league, rounds and reward categories before preparing launch.");
    else if (["reward_setup_conflict", "reward_launch_incomplete"].includes(code)) deps.sendError(res, 409, code, "Reload and review this campaign before preparing launch.");
    else if (code === "invalid_sponsor_launch" || error instanceof z.ZodError) deps.sendError(res, 400, "invalid_sponsor_launch", "Check the launch request.");
    else deps.sendError(res, 503, "reward_launch_unavailable", "Launch details could not be loaded or saved.");
  }
  return true;
}
