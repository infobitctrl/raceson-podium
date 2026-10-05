import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestSession } from "@raceson/domain/auth";
import { PLATFORM_STATISTICS_PERIODS } from "@raceson/domain";
import { forbidden, getPlatformStatistics, type ServerEnv } from "@raceson/db";
import { z } from "zod";

type Dependencies = {
  env: ServerEnv;
  requireSession: (request: IncomingMessage) => Promise<RequestSession>;
  applyPrivateSessionHeaders: (response: ServerResponse) => void;
  sendSuccess: (response: ServerResponse, payload: Record<string, unknown>) => void;
  readStatistics?: typeof getPlatformStatistics;
};

function requireStatisticsAccess(session: RequestSession) {
  if (session.account.platformRole !== "site_admin" && session.account.platformRole !== "super_admin") {
    throw forbidden("Platform administrator access required.");
  }
}

export async function dispatchPlatformStatisticsRoutes(request: IncomingMessage, response: ServerResponse, url: URL, dependencies: Dependencies) {
  if (request.method !== "GET" || url.pathname !== "/api/v1/platform/statistics") return false;
  dependencies.applyPrivateSessionHeaders(response);
  const session = await dependencies.requireSession(request);
  requireStatisticsAccess(session);
  const period = z.enum(PLATFORM_STATISTICS_PERIODS).parse(url.searchParams.get("period") ?? "12m");
  const result = await (dependencies.readStatistics ?? getPlatformStatistics)(session, period, dependencies.env);
  // The role may have changed while paginating; never release a stale authorized read.
  const fresh = await dependencies.requireSession(request);
  requireStatisticsAccess(fresh);
  if (fresh.account.userId !== session.account.userId) throw forbidden("Session changed.");
  dependencies.sendSuccess(response, result as unknown as Record<string, unknown>);
  return true;
}
