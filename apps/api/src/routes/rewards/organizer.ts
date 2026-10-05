import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { listRewardOperatorProgrammes, listRewardOperatorDestinations, listRewardOperatorCampaigns,
  listRewardOperatorAwards, readRewardOperatorAward, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { getOrganizerAthleteReadiness, recordOrganizerAthleteReadiness, revokeOrganizerAthleteReadiness } from "../../features/rewards/organizer-readiness-service.js";
import type { RewardPortalConfig } from "../../features/rewards/request-identity.js";
import { dispatchOrganizerPreparationRoutes } from "./organizer-preparation.js";
import { dispatchOrganizerSportingRoutes } from "./organizer-sporting.js";
import { dispatchOrganizerRecordRoutes } from "./organizer-records.js";
import { dispatchOrganizerClubRoutes } from "./organizer-clubs.js";
import { dispatchClubClaimActionRoutes } from "./club-claims.js";
import type { RewardClubSafeDeploymentReader, RewardClubClaimReader } from "@raceson/rewards-chain";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const attestation = z.object({ schemaVersion: z.literal(1), policy: z.literal("operator-observed-external-wallet-v1"),
  verifiedDateOfBirth: date, identityEvidenceRef: uuid, adultEvidenceRef: uuid, walletMfaEvidenceRef: uuid, walletRecoveryEvidenceRef: uuid }).strict();
const reviewInput = z.object({ expectedProfileFingerprintSha256: z.string().regex(/^[0-9a-f]{64}$/),
  expectedRevision: z.number().int().min(0).max(2147483645), attestation,
  idempotencyKey: z.string().min(8).max(128) }).strict();
const revokeInput = z.object({ reason: z.enum(["identity_uncertain", "age_uncertain", "wallet_security_changed", "operator_correction"]) }).strict();
type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
export type OrganizerRewardRouteDependencies = {
  config: () => RewardPortalConfig | null;
  requireIdentity: (req: IncomingMessage) => Promise<RewardAccountIdentity>;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
  sendSuccess: (res: ServerResponse, payload: Json, statusCode?: number) => void;
  sendError: (res: ServerResponse, statusCode: number, code: string, message: string) => void;
  applyPrivateSessionHeaders: (res: ServerResponse) => void;
  rpc?: RewardLedgerRpc;
  clubReader?: RewardClubSafeDeploymentReader;
  clubClaimReader?: RewardClubClaimReader;
};
const conflicts = new Set(["reward_readiness_revision_changed", "reward_readiness_profile_changed", "reward_readiness_hold",
  "reward_ledger_idempotency_conflict", "reward_destination_proof_required"]);

/** Demo-only programme-operator adapter, not ordinary organizer RBAC or an RPC
 * proxy. Identity comes from verified server Auth; SQL enforces actual current
 * programme authority. No endpoint activates, signs, queues or sends a payment. */
export async function dispatchOrganizerRewardRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: OrganizerRewardRouteDependencies) {
  if (url.pathname.startsWith("/api/v1/organizer/") && await dispatchClubClaimActionRoutes(req, res, url, deps)) return true;
  if (await dispatchOrganizerClubRoutes(req, res, url, deps)) return true;
  if (await dispatchOrganizerRecordRoutes(req, res, url, deps)) return true;
  if (await dispatchOrganizerSportingRoutes(req, res, url, deps)) return true;
  if (await dispatchOrganizerPreparationRoutes(req, res, url, deps)) return true;
  const path = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/destinations\/([^/]+)\/readiness(?:\/([^/]+)\/revoke)?$/.exec(url.pathname);
  const discovery = /^\/api\/v1\/organizer\/rewards\/programmes(?:\/([^/]+)\/destinations)?$/.exec(url.pathname);
  const distribution = /^\/api\/v1\/organizer\/rewards\/programmes\/([^/]+)\/campaigns(?:\/([^/]+)\/allocations\/([^/]+)\/awards(?:\/([^/]+))?)?$/.exec(url.pathname);
  if (discovery || distribution ? req.method !== "GET" : !path || (!path[3] && req.method !== "GET" && req.method !== "POST") || (path[3] && req.method !== "POST")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const supplied = deps.config(); if (!supplied) return false;
    const config = { ...supplied };
    const identity = await deps.requireIdentity(req);
    if (distribution) {
      if ([...url.searchParams.keys()].some(key => key !== "after" || !distribution[2]) || url.searchParams.getAll("after").length > 1)
        throw new Error("invalid_reward_query");
      const selected = { programmeId: uuid.parse(distribution[1]), chainId: config.chainId };
      if (!distribution[2]) deps.sendSuccess(res, await listRewardOperatorCampaigns(identity, selected, deps.rpc));
      else {
        const input = { ...selected, campaignId: uuid.parse(distribution[2]), allocationId: uuid.parse(distribution[3]),
          afterId: url.searchParams.has("after") ? uuid.parse(url.searchParams.get("after")) : null };
        deps.sendSuccess(res, distribution[4]
          ? await readRewardOperatorAward(identity, { ...input, entitlementId: uuid.parse(distribution[4]) }, deps.rpc)
          : await listRewardOperatorAwards(identity, input, deps.rpc));
      }
      return true;
    }
    if (discovery) {
      if ([...url.searchParams.keys()].some(key => key !== "after") || url.searchParams.getAll("after").length > 1)
        throw new Error("invalid_reward_query");
      const afterId = url.searchParams.has("after") ? uuid.parse(url.searchParams.get("after")) : null;
      const input = { chainId: config.chainId, afterId };
      deps.sendSuccess(res, discovery[1]
        ? await listRewardOperatorDestinations(identity, { ...input, programmeId: uuid.parse(discovery[1]) }, deps.rpc)
        : await listRewardOperatorProgrammes(identity, input, deps.rpc));
      return true;
    }
    if (!path) return false;
    if ([...url.searchParams].length) throw new Error("invalid_reward_query");
    const selected = { programmeId: uuid.parse(path[1]), requestId: uuid.parse(path[2]) }, options = { ...config, rpc: deps.rpc };
    if (path[3]) {
      const reviewId = uuid.parse(path[3]), input = revokeInput.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await revokeOrganizerAthleteReadiness(identity, { ...selected, reviewId, ...input }, options));
    } else if (req.method === "POST") {
      const input = reviewInput.parse(await deps.readJsonBody(req));
      deps.sendSuccess(res, await recordOrganizerAthleteReadiness(identity, { ...selected, ...input }, options));
    } else deps.sendSuccess(res, await getOrganizerAthleteReadiness(identity, selected, options));
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    const message = error instanceof Error ? error.message : null;
    if (code === "reward_account_session_required" || message === "Unauthorized" || message === "Missing bearer token")
      deps.sendError(res, 401, "reward_auth_required", "Sign in again to review reward readiness.");
    else if (message === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_operator_permission_required")
      deps.sendError(res, 403, code, "Only the designated programme operator can review reward readiness.");
    else if (code === "reward_distribution_scope_required")
      deps.sendError(res, 404, "reward_distribution_not_found", "Saved reward allocation not found in this programme and network.");
    else if (code === "reward_readiness_scope_required" || code === "reward_wallet_context_mismatch")
      deps.sendError(res, 404, "reward_readiness_not_found", "Reward readiness record not found in this programme and network.");
    else if (code && conflicts.has(code))
      deps.sendError(res, 409, code, "The review is held or has changed. Reload it before making another decision.");
    else if (error instanceof z.ZodError || message === "invalid_reward_query")
      deps.sendError(res, 400, "invalid_reward_request", "Check the selected review and complete evidence references.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Reward reviews are temporarily unavailable. Try again later.");
  }
  return true;
}
