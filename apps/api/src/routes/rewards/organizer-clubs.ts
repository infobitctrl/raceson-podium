import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { decodeRewardClubReviewEvidence, listRewardOperatorClubTreasuries } from "@raceson/db/rewards";
import { RewardProtocolError } from "@raceson/rewards-chain";
import { getOrganizerClubTreasury, observeOrganizerClubTreasury, recordOrganizerClubTreasuryReview, revokeOrganizerClubTreasuryReview } from "../../features/rewards/organizer-club-treasury-service.js";
import { createRewardClubReviewReader } from "../../features/rewards/claim-chain-reader.js";
import type { OrganizerRewardRouteDependencies } from "./organizer.js";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(v => v !== "00000000-0000-0000-0000-000000000000");
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(v => BigInt(v) > 1n).transform(v => v as `0x${string}`);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).refine(v => BigInt(v) > 0n).transform(v => v as `0x${string}`);
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(v => BigInt(v) < (1n << 256n));
const block = z.object({ number: uint, timestamp: uint, hash }).strict();
const version = { expectedIdentityFingerprintSha256: z.string().regex(/^[0-9a-f]{64}$/), expectedRevision: z.number().int().min(0).max(2147483645) };
const observation = z.object({ ...version, factoryAddress: address, deploymentTransactionHash: hash }).strict();
const evidence = z.object({ schemaVersion: z.literal(1), policy: z.literal("operator-reviewed-original-safe-v1"), chainId: z.union([z.literal(31337), z.literal(10143)]),
  candidate: z.object({ safeAddress: address, singletonAddress: address, fallbackHandlerAddress: address, owners: z.array(address).length(3) }).strict(),
  factoryAddress: address, deploymentTransactionHash: hash, initializerHash: hash, deploymentBlock: block, reviewedBlock: block,
  authorityEvidenceRef: uuid, controlEvidenceRef: uuid, recoveryEvidenceRef: uuid, executionHistoryEvidenceRef: uuid }).strict();
const record = z.object({ ...version, evidence, idempotencyKey: z.string().min(8).max(128), confirmReview: z.literal(true) }).strict();
const revoke = z.object({ reason: z.enum(["authority_uncertain", "key_control_changed", "wallet_history_uncertain", "operator_correction"]), confirmRevoke: z.literal(true) }).strict();
const conflicts = new Set(["reward_club_review_identity_changed", "reward_club_review_revision_changed", "reward_club_review_hold", "reward_ledger_idempotency_conflict"]);

/** Demo-only review commands. No generic RPC proxy, signer, payment or key input. */
export async function dispatchOrganizerClubRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  const path = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/club-treasuries(?:\/([^/]+)\/(review|observe|reviews\/([^/]+)\/revoke))?$/.exec(url.pathname);
  if (!path || (!path[2] ? req.method !== "GET" : path[3] === "review" ? !["GET", "POST"].includes(req.method ?? "") : req.method !== "POST")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const supplied = deps.config(); if (!supplied) return false; const config = { ...supplied };
    const identity = await deps.requireIdentity(req), programmeId = uuid.parse(path[1]);
    if ([...url.searchParams.keys()].some(k => k !== "after" || !!path[2]) || url.searchParams.getAll("after").length > 1) throw Error("invalid_reward_query");
    if (!path[2]) {
      deps.sendSuccess(res, await listRewardOperatorClubTreasuries(identity, { programmeId, chainId: config.chainId,
        afterId: url.searchParams.has("after") ? uuid.parse(url.searchParams.get("after")) : null }, deps.rpc)); return true;
    }
    const selected = { programmeId, requestId: uuid.parse(path[2]) }, options = { ...config, rpc: deps.rpc };
    if (req.method === "GET") deps.sendSuccess(res, await getOrganizerClubTreasury(identity, selected, options));
    else if (path[4]) {
      const reviewId = uuid.parse(path[4]), body = revoke.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await revokeOrganizerClubTreasuryReview(identity, { ...selected, reviewId, reason: body.reason }, options));
    } else {
      const reader = deps.clubReader ?? (() => createRewardClubReviewReader(config));
      if (path[3] === "observe") {
        const body = observation.parse(await deps.readJsonBody(req));
        deps.sendSuccess(res, await observeOrganizerClubTreasury(identity, { ...selected, ...body }, { ...options, reader }));
      } else {
        const { confirmReview: _confirm, evidence: raw, ...body } = record.parse(await deps.readJsonBody(req));
        let checked;
        try { checked = decodeRewardClubReviewEvidence(raw); } catch { throw Error("invalid_reward_query"); }
        deps.sendSuccess(res, await recordOrganizerClubTreasuryReview(identity, { ...selected, ...body, evidence: checked }, { ...options, reader }));
      }
    }
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in again to review club treasuries.");
    else if (message === "Untrusted browser origin" || code === "reward_operator_permission_required")
      deps.sendError(res, 403, "reward_operator_permission_required", "Current programme authority is required.");
    else if (code === "reward_club_review_scope_required" || code === "reward_club_review_chain_mismatch" || code === "reward_club_review_candidate_mismatch")
      deps.sendError(res, 404, "reward_club_review_not_found", "Treasury nomination not found in this programme and network.");
    else if (conflicts.has(code ?? "")) deps.sendError(res, 409, code!, "The nomination or review changed. Reload before a new decision.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query" || code === "invalid_reward_club_review")
      deps.sendError(res, 400, "invalid_reward_request", "Check the selected treasury, evidence and explicit confirmation.");
    else if (error instanceof RewardProtocolError && !code?.endsWith("unavailable"))
      deps.sendError(res, 409, "reward_club_chain_check_failed", "The nominated treasury did not pass the supported chain checks.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Club treasury reviews are temporarily unavailable.");
  }
  return true;
}
