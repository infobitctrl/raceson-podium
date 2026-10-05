import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { RewardProtocolError } from "@raceson/rewards-chain";
import { prepareOrganizerClubClaim, getClubClaimAction, submitClubClaimAction } from "../../features/rewards/club-claim-action-service.js";
import { createRewardClubClaimReader } from "../../features/rewards/claim-chain-reader.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const uuid = z.string().uuid(), key = z.string().min(8).max(128);
const prepare = z.object({ reviewId: uuid, entitlementId: uuid, idempotencyKey: key, confirmPrepare: z.literal(true) }).strict();
const consent = z.object({ signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2}){1,8192}$/).transform(v => v as `0x${string}`),
  idempotencyKey: key, confirmConsent: z.literal(true) }).strict();
const approval = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform(v => v as `0x${string}`),
  idempotencyKey: key, confirmApproval: z.literal(true) }).strict();
const conflicts = new Set(["reward_claim_readiness_required", "reward_claim_not_live", "reward_claim_campaign_not_ready", "reward_claim_already_prepared",
  "reward_claim_identity_mapping_required", "reward_club_execution_changed_since_review", "reward_claim_recipient_consent_required", "reward_claim_review_changed",
  "reward_ledger_idempotency_conflict", "reward_claim_observation_stale", "reward_claim_observation_regressed", "reward_club_review_identity_changed",
  "reward_review_superseded", "reward_review_source_changed", "reward_mapping_source_not_ready", "reward_record_approval_withdrawn",
  "reward_record_approval_superseded", "reward_record_source_changed", "reward_record_source_not_ready"]);

/** Separate demo commands with route-fixed roles, explicit confirmations and
 * exact scope. No generic signature endpoint, arbitrary RPC or payment send. */
export async function dispatchClubClaimActionRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const op = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/club-claims(?:\/([^/]+)\/approval)?$/.exec(url.pathname);
  const club = /^\/api\/v1\/athlete\/rewards\/club-claims\/([^/]+)\/consent$/.exec(url.pathname);
  if ((!op && !club) || (op && !op[2] ? req.method !== "POST" : !["GET", "POST"].includes(req.method ?? ""))) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const supplied = deps.config(); if (!supplied) return false; const config = { ...supplied };
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw Error("invalid_reward_query");
    const programmeId = op ? uuid.parse(op[1]) : undefined;
    const options = { ...config, rpc: deps.rpc, reader: deps.clubClaimReader ?? (() => createRewardClubClaimReader(config)) };
    if (op && !op[2]) {
      const { confirmPrepare: _confirm, ...body } = prepare.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await prepareOrganizerClubClaim(identity, { programmeId: programmeId!, ...body }, options));
    } else {
      const selected = { intentId: uuid.parse(op?.[2] ?? club?.[1]), role: op ? "operator" as const : "recipient" as const, programmeId };
      if (req.method === "GET") deps.sendSuccess(res, await getClubClaimAction(identity, selected, options));
      else {
        const body = op ? approval.parse(await deps.readJsonBody(req)) : consent.parse(await deps.readJsonBody(req));
        deps.sendSuccess(res, await submitClubClaimAction(identity, { ...selected, signature: body.signature, idempotencyKey: body.idempotencyKey }, options));
      }
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (message === "Unauthorized" || message === "Missing bearer token" || code === "reward_account_session_required")
      deps.sendError(res, 401, "reward_auth_required", "Sign in again before reviewing or consenting to club rewards.");
    else if (message === "Untrusted browser origin" || code === "reward_operator_permission_required")
      deps.sendError(res, 403, "forbidden", "Current authority for this reward action is required.");
    else if (code === "reward_claim_scope_required" || code === "reward_claim_proof_scope_required" || code === "reward_club_review_chain_mismatch")
      deps.sendError(res, 404, "reward_club_claim_not_found", "Club claim not found in this account, programme and network.");
    else if (conflicts.has(code ?? "")) deps.sendError(res, 409, code!, "The claim is held or changed. Review its current state before a new decision.");
    else if (error instanceof z.ZodError || error instanceof SyntaxError || message === "invalid_reward_query"
      || code === "invalid_reward_claim_request" || code === "invalid_reward_claim_proof_request" || code === "invalid_reward_claim_signature")
      deps.sendError(res, 400, "invalid_reward_claim_request", "Use the exact claim, signature and explicit confirmation.");
    else if (error instanceof RewardProtocolError && !code?.endsWith("unavailable"))
      deps.sendError(res, 409, "reward_club_claim_check_failed", "The claim or signature did not pass its chain checks.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Club claim verification is temporarily unavailable.");
  }
  return true;
}
