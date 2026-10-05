import type { IncomingMessage, ServerResponse } from "node:http";
import { decodeFinalResultsCanaryStatus, type FinalResultsCanaryStatus } from "@raceson/domain/rewards/final-results-canary";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
import { publicFinalResultsCanaryStatus } from "../../features/rewards/final-results-canary-status-service.js";

export async function dispatchFinalResultsCanaryStatusRoute(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Pick<OrganizerRewardRouteDependencies, "config" | "sendSuccess" | "sendError">,
  observe: () => Promise<FinalResultsCanaryStatus> = publicFinalResultsCanaryStatus) {
  if (url.pathname !== "/api/v1/rewards/canary/final-results") return false;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); deps.sendError(res, 405, "method_not_allowed", "Read-only endpoint."); return true; }
  try {
    const config = deps.config();
    if (!config || config.chainId !== 10143) { deps.sendError(res, 409, "canary_testnet_required", "Open the isolated Monad testnet demo."); return true; }
    if ([...url.searchParams].length) { deps.sendError(res, 400, "invalid_canary_query", "This endpoint has no address or provider parameters."); return true; }
    deps.sendSuccess(res, JSON.parse(JSON.stringify(decodeFinalResultsCanaryStatus(await observe()))));
  } catch (error) {
    if (error instanceof Error && error.message === "canary_rate_limited") {
      res.setHeader("Retry-After", "3"); deps.sendError(res, 429, "canary_rate_limited", "Wait a few seconds before refreshing.");
    } else deps.sendError(res, 503, "canary_observation_unavailable", "Current testnet state could not be verified.");
  }
  return true;
}
