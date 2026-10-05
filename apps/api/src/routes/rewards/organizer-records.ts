import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { approveOrganizerRecord, captureOrganizerRecord, getOrganizerRecordWorkspace, listOrganizerRecordRaces,
  previewOrganizerRecord, withdrawOrganizerRecord } from "../../features/rewards/organizer-records-service.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(v => v !== "00000000-0000-0000-0000-000000000000");
const retry = z.string().min(8).max(128), revision = z.number().int().min(0).max(2147483645);
const draft = z.object({ priorSnapshotId: uuid, targetRaceId: uuid, baselineSourceId: uuid, gender: z.enum(["M", "F"]),
  comparison: z.unknown(), expectedRevision: revision }).strict();
const conflicts = new Set(["reward_campaign_allocation_already_reserved", "reward_record_revision_changed", "reward_record_preview_changed",
  "reward_record_source_changed", "reward_review_source_changed", "reward_record_source_not_ready", "reward_record_approval_already_withdrawn",
  "reward_record_capture_idempotency_conflict", "reward_ledger_idempotency_conflict"]);
const invalidEvidence = new Set(["invalid_reward_record_comparison", "invalid_record_gender", "invalid_reward_record_integer",
  "reward_record_direction_not_comparable", "reward_record_timing_not_comparable", "reward_record_precision_not_comparable",
  "reward_record_comparison_review_required", "reward_record_target_scope_mismatch", "reward_record_publication_not_ready",
  "reward_record_course_not_comparable", "reward_record_unresolved_adjudication", "reward_round_has_unresolved_adjudication",
  "record_requires_verified_race_start", "unresolved_reward_identity", "reward_record_row_provenance_mismatch",
  "reward_record_result_state_invalid", "reward_record_contradictory_finish", "reward_record_duplicate_finish_requires_review",
  "record_gender_requires_review", "reward_record_precision_or_time_invalid", "reward_record_not_fastest_verified_source",
  "record_baseline_must_precede_race"]);

export async function dispatchOrganizerRecordRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const path = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/campaigns\/([^/]+)\/sources\/([^/]+)\/(record-workspace|record-races|record-captures(?:\/([^/]+))?|record-preview|record-approvals(?:\/([^/]+)\/withdraw)?)$/.exec(url.pathname);
  if (!path) return false;
  const action = path[4], read = action === "record-workspace" || action === "record-races" || !!path[5];
  if (req.method !== (read ? "GET" : "POST")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const supplied = deps.config(); if (!supplied) return false; const config = { ...supplied }, identity = await deps.requireIdentity(req);
    const scope = { programmeId: uuid.parse(path[1]), campaignId: uuid.parse(path[2]), snapshotId: uuid.parse(path[3]), chainId: config.chainId };
    if ([...url.searchParams.keys()].some(k => k !== "after" || !(action === "record-races" || path[5])) || url.searchParams.getAll("after").length > 1)
      throw Error("invalid_reward_query");
    const after = url.searchParams.has("after") ? uuid.parse(url.searchParams.get("after")) : null;
    if (action === "record-races") deps.sendSuccess(res, await listOrganizerRecordRaces(identity, scope, after, deps.rpc));
    else if (read) deps.sendSuccess(res, await getOrganizerRecordWorkspace(identity, scope,
      { priorSnapshotId: path[5] ? uuid.parse(path[5]) : null, afterId: after }, deps.rpc));
    else if (action === "record-captures") {
      const body = z.object({ priorRaceId: uuid, idempotencyKey: retry, confirmCapture: z.literal(true) }).strict().parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await captureOrganizerRecord(identity, scope, body, deps.rpc));
    } else if (path[6]) {
      const body = z.object({ expectedRevision: z.number().int().min(1).max(2147483646), idempotencyKey: retry,
        reason: z.string().trim().min(8).max(4000), confirmWithdrawal: z.literal(true) }).strict().parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await withdrawOrganizerRecord(identity, scope, { ...body, approvalId: uuid.parse(path[6]) }, deps.rpc));
    } else if (action === "record-preview") {
      const body = draft.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await previewOrganizerRecord(identity, scope, { ...body, comparison: body.comparison }, deps.rpc));
    } else {
      const body = draft.extend({ previewDigest: z.string().regex(/^[0-9a-f]{64}$/), idempotencyKey: retry, confirmApproval: z.literal(true) }).strict().parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await approveOrganizerRecord(identity, scope, { ...body, comparison: body.comparison }, deps.rpc));
    }
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in again to review record evidence.");
    else if (["reward_operator_permission_required", "reward_source_permission_required"].includes(code ?? "") || message === "Untrusted browser origin")
      deps.sendError(res, 403, "reward_operator_permission_required", "Current programme authority is required.");
    else if (["reward_distribution_scope_required", "reward_preparation_scope_required", "reward_record_source_scope_mismatch", "reward_record_approval_required"].includes(code ?? ""))
      deps.sendError(res, 404, "reward_record_not_found", "Record evidence not found in this programme and network.");
    else if (conflicts.has(code ?? "")) deps.sendError(res, 409, code!, "The record state has changed. Inspect it before a new decision.");
    else if (invalidEvidence.has(code ?? "")) deps.sendError(res, 422, code!, "Record evidence or the comparison is incomplete. No approval was saved.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || code === "invalid_reward_record_request")
      deps.sendError(res, 400, "invalid_reward_request", "Check the selected evidence and explicit confirmation.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Record review is temporarily unavailable.");
  }
  return true;
}
