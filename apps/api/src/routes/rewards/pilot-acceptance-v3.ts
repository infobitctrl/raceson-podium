import type { IncomingMessage, ServerResponse } from "node:http";
import type { RewardAccountIdentity } from "@raceson/db/rewards";
import { decodePilotChangeV3, decodePilotViewV3, type PilotChangeV3, type PilotRoundV3 } from "@raceson/domain/rewards/pilot-acceptance-v3";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

/** Capability supplied ONLY by the explicitly armed loopback demo launcher.
 * Authentication is still the request's own identity, never an operator login. */
export type LocalPilotRunnerV3 = (identity: RewardAccountIdentity, round: PilotRoundV3,
  change: PilotChangeV3 | undefined, signal: AbortSignal) => Promise<unknown>;
export async function dispatchPilotAcceptanceV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: OrganizerRewardRouteDependencies, run?: LocalPilotRunnerV3) {
  const match = /^\/api\/v1\/organizer\/rewards\/local-pilot\/([234])$/.exec(url.pathname);
  if (!match || !["GET", "POST"].includes(req.method ?? "")) return false;
  deps.applyPrivateSessionHeaders(res);
  const abort = new AbortController();
  const closed = () => { if (!res.writableEnded) abort.abort(); };
  res.on("close", closed);
  try {
    const config = deps.config();
    if (!run || config?.chainId !== 10143 || req.headers.host !== "127.0.0.1:3102" ||
      !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") ||
      req.headers.forwarded || (req.headers["x-forwarded-host"] !== undefined && req.headers["x-forwarded-host"] !== "127.0.0.1:3102") ||
      (req.headers["x-forwarded-for"] !== undefined && !["127.0.0.1", "::ffff:127.0.0.1"].includes(String(req.headers["x-forwarded-for"]))) ||
      (req.method === "POST" && req.headers.origin !== "http://127.0.0.1:3102")) {
      deps.sendError(res, 404, "reward_local_pilot_unavailable", "Local operator controls are not enabled."); return true;
    }
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_pilot_view");
    const round = Number(match[1]) as PilotRoundV3;
    const change = req.method === "POST" ? decodePilotChangeV3(await deps.readJsonBody(req)) : undefined;
    const result = decodePilotViewV3(await run(identity, round, change, abort.signal), round);
    if (!abort.signal.aborted) deps.sendSuccess(res, result);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (abort.signal.aborted) return true;
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code))
      deps.sendError(res, 401, "reward_auth_required", "Sign in to the isolated demo.");
    else if (["reward_planning_not_found", "reward_readiness_scope_required"].includes(code))
      deps.sendError(res, 403, "reward_pilot_operator_required", "This programme requires its authorized operator.");
    else if (code === "invalid_reward_pilot_view") deps.sendError(res, 400, code, "Check the selected pilot step.");
    else if (code === "reward_pilot_changed") deps.sendError(res, 409, code, "The pilot changed. Refresh before choosing the next action.");
    else deps.sendError(res, 503, "reward_pilot_unavailable", "Execution stopped safely. Refresh to inspect the recorded step before retrying.");
  } finally { res.off("close", closed); }
  return true;
}
