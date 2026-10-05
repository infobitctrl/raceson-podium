import type { IncomingMessage, ServerResponse } from "node:http";
import { decodePublicRewardReport } from "@raceson/domain/rewards/public-report";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

export type PublicRewardReportReader = () => unknown;
export async function dispatchPublicRewardReport(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Pick<OrganizerRewardRouteDependencies, "config" | "sendSuccess" | "sendError">,
  read?: PublicRewardReportReader) {
  if (url.pathname !== "/api/v1/rewards/public-report") return false;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow","GET"); deps.sendError(res,405,"method_not_allowed","Read-only report."); return true; }
  if ([...url.searchParams].length) { deps.sendError(res,400,"invalid_public_report_query","This report accepts no recipient or programme parameters."); return true; }
  try {
    if (deps.config()?.chainId !== 10143 || !read) throw new Error("report_unavailable");
    // Host provides only an explicitly exported report, never a private SQL reader.
    deps.sendSuccess(res,decodePublicRewardReport(read()));
  } catch { deps.sendError(res,503,"public_reward_report_unavailable","The public reward report is unavailable."); }
  return true;
}
