import type { IncomingMessage, ServerResponse } from "node:http";
import { decodeCanaryStatus } from "@raceson/domain/rewards/canary";
import type { CanaryStatus } from "@raceson/domain/rewards/canary";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
import { publicCanaryStatus } from "../../features/rewards/canary-status-service.js";

export async function dispatchCanaryStatusRoute(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Pick<OrganizerRewardRouteDependencies, "config" | "sendSuccess" | "sendError">,
  observe: () => Promise<CanaryStatus> = publicCanaryStatus) {
  if (url.pathname !== "/api/v1/rewards/canary") return false;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); deps.sendError(res, 405, "method_not_allowed", "Read-only endpoint."); return true; }
  try {
    const config = deps.config();
    if (!config || config.chainId !== 10143) { deps.sendError(res, 409, "canary_testnet_required", "Open the isolated Monad testnet demo."); return true; }
    if ([...url.searchParams].length) { deps.sendError(res, 400, "invalid_canary_query", "This endpoint has no address or provider parameters."); return true; }
    // Explicitly public fixed infrastructure, not authenticated athlete/club data.
    const result = decodeCanaryStatus(await observe());
    deps.sendSuccess(res, JSON.parse(JSON.stringify(result)));
  } catch (error) {
    if (error instanceof Error && error.message === "canary_rate_limited") {
      res.setHeader("Retry-After", "3"); deps.sendError(res, 429, "canary_rate_limited", "Wait a few seconds before refreshing.");
    } else deps.sendError(res, 503, "canary_observation_unavailable", "Current testnet state could not be verified.");
  }
  return true;
}
