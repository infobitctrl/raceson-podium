import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { dispatchAthleteRewardRoutes } from "./athlete.js";
import { getAthleteReadinessV3, reviewAthleteReadinessV3, revokeAthleteReadinessV3 } from "../../features/rewards/athlete-readiness-v3-service.js";
import { privyTestnetReadinessPolicy, privyTestnetReadinessAppId } from "@raceson/db/rewards";
const externalAttestation = z.object({ schemaVersion: z.literal(1), policy: z.literal("operator-observed-external-wallet-v1"),
  verifiedDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), identityEvidenceRef: z.string().uuid(), adultEvidenceRef: z.string().uuid(),
  walletMfaEvidenceRef: z.string().uuid(), walletRecoveryEvidenceRef: z.string().uuid() }).strict();
const privyAttestation = z.object({ schemaVersion: z.literal(2), policy: z.literal(privyTestnetReadinessPolicy),
  chainId: z.literal(10143), privyAppId: z.literal(privyTestnetReadinessAppId),
  verifiedDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), identityEvidenceRef: z.string().uuid(), adultEvidenceRef: z.string().uuid(),
  walletProviderEvidenceRef: z.string().uuid(), walletRecoveryEvidenceRef: z.string().uuid() }).strict();
const attestation = z.union([externalAttestation, privyAttestation]);
const review = z.object({ reviewId: z.string().uuid(), previousReviewId: z.string().uuid().nullable(),
  sourceGuardHash: z.string().regex(/^[0-9a-f]{64}$/), profileFingerprint: z.string().regex(/^[0-9a-f]{64}$/), attestation }).strict();
const revocation = z.object({ reviewId: z.string().uuid(), reason: z.enum(["identity_uncertain", "age_uncertain", "wallet_security_changed", "operator_correction"]) }).strict();
export async function dispatchAthleteReadinessV3(req: IncomingMessage, res: ServerResponse, url: URL,
  deps: Parameters<typeof dispatchAthleteRewardRoutes>[3]) {
  const match = /^\/api\/v1\/(athlete|organizer)\/rewards\/uploads\/([^/]+)\/destinations\/([^/]+)\/readiness-v3(\/revoke)?$/.exec(url.pathname);
  if (!match || !["GET", "POST"].includes(req.method ?? "") || (req.method === "GET" && match[4])
    || (req.method === "POST" && match[1] !== "organizer")) return false;
  deps.applyPrivateSessionHeaders(res);
  try {
    const config = deps.config(); if (!config) return false;
    const identity = await deps.requireIdentity(req);
    if ([...url.searchParams].length) throw new Error("invalid_reward_query");
    const scope = { uploadId: z.string().uuid().parse(match[2]), destinationId: z.string().uuid().parse(match[3]) };
    const dependencies = { ...config, rpc: deps.rpc };
    const result = req.method === "GET" ? await getAthleteReadinessV3(identity, { ...scope, role: match[1] === "athlete" ? "recipient" : "operator" }, dependencies)
      : match[4] ? await revokeAthleteReadinessV3(identity, { ...scope, ...revocation.parse(await deps.readJsonBody(req)) }, dependencies)
        : await reviewAthleteReadinessV3(identity, { ...scope, ...review.parse(await deps.readJsonBody(req)) }, dependencies);
    deps.sendSuccess(res, result);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
    if (["reward_account_session_required", "Unauthorized", "Missing bearer token"].includes(code))
      deps.sendError(res, 401, "reward_auth_required", "Sign in to access reward readiness.");
    else if (code === "Untrusted browser origin") deps.sendError(res, 403, "forbidden", "This browser request is not allowed.");
    else if (code === "reward_readiness_scope_required") deps.sendError(res, 404, code, "Reward readiness not found.");
    else if (["reward_readiness_revision_changed", "reward_readiness_profile_changed", "reward_planning_revision_changed", "reward_readiness_hold", "reward_ledger_idempotency_conflict"].includes(code))
      deps.sendError(res, 409, code, "The source, profile or review changed. Inspect it again before approving.");
    else if (error instanceof z.ZodError || ["invalid_reward_query", "invalid_reward_readiness_review", "reward_wallet_context_mismatch"].includes(code))
      deps.sendError(res, 400, "invalid_reward_request", "Check the submitted readiness review.");
    else deps.sendError(res, 503, "reward_service_unavailable", "Reward readiness is temporarily unavailable.");
  }
  return true;
}
