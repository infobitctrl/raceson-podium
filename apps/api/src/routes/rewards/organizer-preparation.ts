import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getOrganizerRewardPreparation, reserveOrganizerRewardPreparation } from "../../features/rewards/organizer-preparation-service.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(v => v !== "00000000-0000-0000-0000-000000000000");
const confirm = z.object({ previewDigest: z.string().regex(/^[0-9a-f]{64}$/), idempotencyKey: z.string().min(8).max(128), confirmAllocation: z.literal(true) }).strict();
const conflicts = new Set(["reward_preparation_changed", "reward_campaign_allocation_already_reserved", "reward_review_superseded",
  "reward_review_source_changed", "reward_round_has_unresolved_adjudication", "reward_ledger_idempotency_conflict", "reward_record_approval_omitted",
  "reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_source_changed", "reward_record_source_not_ready"]);
export async function dispatchOrganizerPreparationRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const path = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/campaigns\/([^/]+)\/(?:preparation|reviews\/([^/]+)\/reserve)$/.exec(url.pathname);
  if (!path || req.method !== (path[3] ? "POST" : "GET")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const supplied = deps.config(); if (!supplied) return false; const config = { ...supplied };
    const identity = await deps.requireIdentity(req);
    const scope = { programmeId: uuid.parse(path[1]), campaignId: uuid.parse(path[2]), chainId: config.chainId };
    if ([...url.searchParams.keys()].some(k => k !== "after" || !!path[3]) || url.searchParams.getAll("after").length > 1) throw Error("invalid_reward_query");
    if (path[3]) {
      const reviewId = uuid.parse(path[3]), body = confirm.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await reserveOrganizerRewardPreparation(identity, scope, { ...body, reviewId }, deps.rpc));
    } else {
      const after = url.searchParams.get("after");
      if (after !== null && !/^(athlete|club):[0-9a-f-]{36}$/.test(after)) throw Error("invalid_reward_query");
      if (after !== null) uuid.parse(after.split(":")[1]);
      deps.sendSuccess(res, await getOrganizerRewardPreparation(identity, scope, after, deps.rpc));
    }
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in again to prepare rewards.");
    else if (code === "reward_operator_permission_required" || message === "Untrusted browser origin")
      deps.sendError(res, 403, "reward_operator_permission_required", "Current programme authority is required.");
    else if (["reward_distribution_scope_required", "reward_preparation_scope_required", "reward_calculation_reference_mismatch"].includes(code ?? ""))
      deps.sendError(res, 404, "reward_preparation_not_found", "Reward preparation not found in this programme and network.");
    else if (conflicts.has(code ?? "")) deps.sendError(res, 409, code!, "The allocation or its source has changed. Reload before making a new decision.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || code === "invalid_reward_preparation_request")
      deps.sendError(res, 400, "invalid_reward_request", "Check the selected review and confirmation.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Reward preparation is temporarily unavailable.");
  }
  return true;
}
