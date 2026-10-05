import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getOrganizerSportingSource, getOrganizerSportingRecord, captureOrganizerSportingSource, previewOrganizerSportingReview,
  submitOrganizerSportingReview } from "../../features/rewards/organizer-sporting-service.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(v => v !== "00000000-0000-0000-0000-000000000000");
const retry = z.string().min(8).max(128), digest = z.string().regex(/^[0-9a-f]{64}$/);
const draft = z.object({ expectedRevision: z.number().int().min(0).max(2147483645), review: z.unknown() }).strict();
const submission = draft.extend({ previewDigest: digest, idempotencyKey: retry, confirmReview: z.literal(true) }).strict();
const conflicts = new Set(["reward_campaign_allocation_already_reserved", "reward_sporting_revision_changed", "reward_sporting_preview_changed",
  "reward_review_source_changed", "reward_round_has_unresolved_adjudication", "reward_ledger_idempotency_conflict", "reward_capture_idempotency_conflict",
  "reward_record_approval_omitted", "reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_source_changed",
  "reward_record_source_not_ready", "reward_round_not_ready", "reward_mapping_source_not_ready", "reward_competition_not_active", "unresolved_reward_identity"]);
const sporting = new Set(["reward_membership_review_incomplete", "invalid_reviewed_reward_membership", "reward_podium_review_incomplete",
  "reward_podium_members_missing", "inconsistent_podium_rank_structure", "invalid_podium_rank", "duplicate_athlete_round_requires_review",
  "stale_adjudication_sources", "stale_adjudication", "invalid_adjudicated_source", "duplicate_adjudication", "reward_record_approval_required",
  "reward_record_approval_mismatch", "reward_round_review_scope_mismatch", "invalid_record_divisions", "league_reward_review_has_round_awards"]);

export async function dispatchOrganizerSportingRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const path = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/campaigns\/([^/]+)\/sources(?:\/([^/]+)(?:\/(review-preview|reviews|record-approvals\/([^/]+)))?)?$/.exec(url.pathname);
  if (!path) return false;
  const capture = path[3] === "capture" && !path[4], record = !!path[5], write = capture || (!!path[4] && !record);
  if (req.method !== (write ? "POST" : "GET")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const configured = deps.config(); if (!configured) return false; const config = { ...configured }, identity = await deps.requireIdentity(req);
    const scope = { programmeId: uuid.parse(path[1]), campaignId: uuid.parse(path[2]), chainId: config.chainId };
    if ([...url.searchParams.keys()].some(k => k !== "after" || write || record || !path[3]) || url.searchParams.getAll("after").length > 1)
      throw Error("invalid_reward_query");
    if (capture) {
      const input = z.object({ idempotencyKey: retry, confirmCapture: z.literal(true) }).strict().parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await captureOrganizerSportingSource(identity, scope, input, deps.rpc));
    } else {
      const snapshotId = path[3] ? uuid.parse(path[3]) : null;
      if (record) deps.sendSuccess(res, await getOrganizerSportingRecord(identity, scope, { snapshotId: snapshotId!, approvalId: uuid.parse(path[5]) }, deps.rpc));
      else if (!write) deps.sendSuccess(res, await getOrganizerSportingSource(identity, scope,
        { snapshotId, afterId: url.searchParams.has("after") ? uuid.parse(url.searchParams.get("after")) : null }, deps.rpc));
      else if (path[4] === "review-preview") {
        const input = draft.parse(await deps.readJsonBody(req));
        deps.sendSuccess(res, await previewOrganizerSportingReview(identity, scope,
          { ...input, review: input.review, snapshotId: snapshotId! }, deps.rpc));
      } else {
        const input = submission.parse(await deps.readJsonBody(req));
        deps.sendSuccess(res, await submitOrganizerSportingReview(identity, scope,
          { ...input, review: input.review, snapshotId: snapshotId! }, deps.rpc));
      }
    }
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in again to review sporting evidence.");
    else if (["reward_operator_permission_required", "reward_source_permission_required"].includes(code ?? "") || message === "Untrusted browser origin")
      deps.sendError(res, 403, "reward_operator_permission_required", "Current programme authority is required.");
    else if (["reward_distribution_scope_required", "reward_preparation_scope_required", "reward_calculation_reference_mismatch", "reward_sporting_source_required"].includes(code ?? ""))
      deps.sendError(res, 404, "reward_sporting_source_not_found", "Source not found in this programme and network.");
    else if (conflicts.has(code ?? "")) deps.sendError(res, 409, code!, "The source or review state has changed. Inspect it before a new decision.");
    else if (sporting.has(code ?? "")) deps.sendError(res, 422, code!, "Sporting evidence is incomplete or inconsistent. No review was saved.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || code === "invalid_reward_sporting_request")
      deps.sendError(res, 400, "invalid_reward_request", "Check the selected source and explicit confirmation.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Sporting review is temporarily unavailable.");
  }
  return true;
}
