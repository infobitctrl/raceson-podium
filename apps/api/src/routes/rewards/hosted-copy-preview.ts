import type { IncomingMessage, ServerResponse } from "node:http";
import { loadServerEnv } from "@raceson/db";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
import { hostedCopyPreviewEnabled, readHostedCopyPreview } from "../../features/rewards/hosted-copy-preview.js";

export async function dispatchHostedCopyPreview(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies,
  read = readHostedCopyPreview) {
  if (url.pathname !== "/api/v1/rewards/demo-copy/preview") return false;
  deps.applyPrivateSessionHeaders(res);
  if (req.method !== "GET" || [...url.searchParams].length) { deps.sendError(res, 400, "invalid_copy_request", "Refresh the demo preview."); return true; }
  try {
    const env = loadServerEnv();
    if (!hostedCopyPreviewEnabled(process.env, env) || deps.config()?.chainId !== 10143) throw Error("hosted_copy_unavailable");
    const identity = await deps.requireIdentity(req);
    deps.sendSuccess(res, await read(identity, env));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["Unauthorized", "Missing bearer token", "reward_account_session_required"].includes(message)) deps.sendError(res, 401, "reward_auth_required", "Sign in to the demo to view results.");
    else if (message === "Untrusted browser origin" || message === "reward_demo_account_required") deps.sendError(res, 403, "reward_demo_access_required", "Use a provisioned Podium demo account.");
    else deps.sendError(res, 503, "hosted_copy_unavailable", "The verified demo results are temporarily unavailable.");
  }
  return true;
}
