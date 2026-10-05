import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardClubTreasuryCandidate, decodeRewardClubTreasuryDocument } from "./club-treasuries.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value: unknown): asserts value { if (!value) throw new RewardLedgerStoreError("invalid_reward_club_review_document"); }
function fingerprint(value: unknown): string { demand(typeof value === "string" && /^[0-9a-f]{64}$/.test(value)); return value; }
function hash(value: unknown): `0x${string}` { demand(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n); return value as `0x${string}`; }
function address(value: unknown): `0x${string}` { demand(typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value) > 1n); return value as `0x${string}`; }
function uint(value: unknown): string { demand(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n); return value; }
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function revision(value: unknown, min = 0): number { demand(Number.isSafeInteger(value) && (value as number) >= min && (value as number) < 2147483647); return value as number; }
function stamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
function block(value: unknown) { const b = object(value, ["number", "hash", "timestamp"]); return { number: uint(b.number), hash: hash(b.hash), timestamp: uint(b.timestamp) }; }
const reasons = ["authority_uncertain", "key_control_changed", "wallet_history_uncertain", "operator_correction"] as const;
export type RewardClubReviewRevocationReason = typeof reasons[number];
function reason(value: unknown) { demand(reasons.includes(value as RewardClubReviewRevocationReason)); return value as RewardClubReviewRevocationReason; }

/** Shape validation only. Chain evidence must be produced/reverified by the
 * private service; UUID refs are explicit human attestations, not proof lookups. */
export function decodeRewardClubReviewEvidence(value: unknown) {
  const e = object(value, ["schemaVersion", "policy", "chainId", "candidate", "factoryAddress", "deploymentTransactionHash", "deploymentBlock", "reviewedBlock",
    "initializerHash", "authorityEvidenceRef", "controlEvidenceRef", "recoveryEvidenceRef", "executionHistoryEvidenceRef"]);
  demand(e.schemaVersion === 1 && e.policy === "operator-reviewed-original-safe-v1" && (e.chainId === 31337 || e.chainId === 10143));
  const candidate = decodeRewardClubTreasuryCandidate(e.candidate), factoryAddress = address(e.factoryAddress);
  demand(![candidate.safeAddress, candidate.singletonAddress, candidate.fallbackHandlerAddress].includes(factoryAddress));
  const deploymentBlock = block(e.deploymentBlock), reviewedBlock = block(e.reviewedBlock);
  demand(BigInt(deploymentBlock.number) > 0n && BigInt(deploymentBlock.number) <= BigInt(reviewedBlock.number)
    && BigInt(deploymentBlock.timestamp) <= BigInt(reviewedBlock.timestamp));
  demand(deploymentBlock.number !== reviewedBlock.number || JSON.stringify(deploymentBlock) === JSON.stringify(reviewedBlock));
  return { schemaVersion: 1 as const, policy: "operator-reviewed-original-safe-v1" as const, chainId: e.chainId as 31337 | 10143, candidate, factoryAddress,
    deploymentTransactionHash: hash(e.deploymentTransactionHash), deploymentBlock, reviewedBlock, initializerHash: hash(e.initializerHash),
    authorityEvidenceRef: uuid(e.authorityEvidenceRef), controlEvidenceRef: uuid(e.controlEvidenceRef), recoveryEvidenceRef: uuid(e.recoveryEvidenceRef),
    executionHistoryEvidenceRef: uuid(e.executionHistoryEvidenceRef) };
}
export type RewardClubReviewEvidence = ReturnType<typeof decodeRewardClubReviewEvidence>;
function decodeReview(value: unknown, programmeId: string, actorUserId: string) {
  const r = object(value, ["reviewId", "programmeId", "requestId", "revision", "reviewedByUserId", "reviewedSessionId", "reviewedAt",
    "identityFingerprintSha256", "evidence", "idempotencyKey", "revokedAt", "revocationReason"]);
  demand(r.programmeId === programmeId && r.reviewedByUserId === actorUserId);
  const reviewedAt = stamp(r.reviewedAt), revokedAt = r.revokedAt === null ? null : stamp(r.revokedAt), why = r.revocationReason === null ? null : reason(r.revocationReason);
  demand((revokedAt === null) === (why === null) && (revokedAt === null || Date.parse(revokedAt) >= Date.parse(reviewedAt)));
  return { reviewId: uuid(r.reviewId), programmeId, requestId: uuid(r.requestId), revision: revision(r.revision, 1), reviewedByUserId: actorUserId,
    reviewedSessionId: uuid(r.reviewedSessionId), reviewedAt, identityFingerprintSha256: fingerprint(r.identityFingerprintSha256),
    evidence: decodeRewardClubReviewEvidence(r.evidence), idempotencyKey: key(r.idempotencyKey), revokedAt, revocationReason: why };
}
export type RewardClubTreasuryReview = ReturnType<typeof decodeReview>;
export { decodeReview as decodeRewardClubTreasuryReview };
const scope = (i: RewardAccountIdentity, programmeId: string) => ({ p_programme_id: uuid(programmeId), p_actor_user_id: uuid(i.userId), p_actor_session_id: uuid(i.sessionId) });
const states = ["unreviewed", "reviewed", "revoked", "identity_hold", "identity_changed", "request_withdrawn"] as const;
export type RewardClubReviewState = typeof states[number];
const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_club_review_scope_required",
  "invalid_reward_club_review", "reward_club_review_revision_changed", "reward_club_review_identity_changed", "reward_club_review_hold", "reward_ledger_idempotency_conflict"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed");
  }
  return result.data;
}
export function decodeRewardClubReviewContext(value: unknown, identity: Pick<RewardAccountIdentity, "userId">, programmeId: string, requestId: string, idempotencyKey: string | null = null) {
  // Structural operator-subject validation, not an Auth session check. RPC
  // callers validate the actual acting session separately before decoding.
  const s = { p_programme_id: uuid(programmeId), p_actor_user_id: uuid(identity.userId) }, id = uuid(requestId), retryKey = idempotencyKey === null ? null : key(idempotencyKey);
  const c = object(value,
    ["programmeId", "operatorUserId", "chainId", "nomination", "identityFingerprintSha256", "latestReview", "retryReview", "reviewState"]);
  demand(c.programmeId === s.p_programme_id && c.operatorUserId === s.p_actor_user_id && (c.chainId === 31337 || c.chainId === 10143));
  const raw = object(c.nomination, ["requestId", "userId", "sessionId", "clubId", "chainId", "candidate", "requestedAt", "idempotencyKey", "withdrawnAt", "status"]);
  const nomination = decodeRewardClubTreasuryDocument(raw, { userId: uuid(raw.userId), chainId: c.chainId });
  demand(nomination.requestId === id);
  const identityFingerprintSha256 = fingerprint(c.identityFingerprintSha256), latestReview = c.latestReview === null ? null : decodeReview(c.latestReview, s.p_programme_id, s.p_actor_user_id);
  const retryReview = c.retryReview === null ? null : decodeReview(c.retryReview, s.p_programme_id, s.p_actor_user_id);
  demand(retryReview === null || (retryKey !== null && retryReview.idempotencyKey === retryKey));
  demand(latestReview === null || (latestReview.requestId === id && latestReview.evidence.chainId === c.chainId
    && JSON.stringify(latestReview.evidence.candidate) === JSON.stringify(nomination.candidate)));
  demand(states.includes(c.reviewState as RewardClubReviewState)); const reviewState = c.reviewState as RewardClubReviewState;
  if (reviewState === "reviewed") demand(latestReview !== null && latestReview.revokedAt === null && nomination.status === "pending_review"
    && latestReview.identityFingerprintSha256 === identityFingerprintSha256);
  if (reviewState === "unreviewed") demand(latestReview === null && nomination.status === "pending_review");
  if (reviewState === "revoked") demand(latestReview?.revokedAt != null);
  if (reviewState === "identity_changed") demand(latestReview !== null && latestReview.identityFingerprintSha256 !== identityFingerprintSha256);
  if (reviewState === "request_withdrawn") demand(nomination.status === "withdrawn");
  return { programmeId: s.p_programme_id, operatorUserId: s.p_actor_user_id, chainId: c.chainId as 31337 | 10143,
    nomination, identityFingerprintSha256, latestReview, retryReview, reviewState };
}
export async function readRewardClubReviewContext(identity: RewardAccountIdentity, programmeId: string, requestId: string, rpc?: RewardLedgerRpc, idempotencyKey: string | null = null) {
  const s = scope(identity, programmeId), id = uuid(requestId), retryKey = idempotencyKey === null ? null : key(idempotencyKey);
  const value = await call("service_read_reward_club_review_context", { ...s, p_request_id: id, p_idempotency_key: retryKey }, rpc);
  return decodeRewardClubReviewContext(value, { userId: s.p_actor_user_id }, s.p_programme_id, id, retryKey);
}
export type RewardClubReviewInput = {
  programmeId: string; requestId: string; expectedIdentityFingerprintSha256: string; expectedRevision: number;
  evidence: RewardClubReviewEvidence; idempotencyKey: string;
};
export function normalizeRewardClubReviewInput(input: RewardClubReviewInput) {
  return { programmeId: uuid(input.programmeId), requestId: uuid(input.requestId), expectedIdentityFingerprintSha256: fingerprint(input.expectedIdentityFingerprintSha256),
    expectedRevision: revision(input.expectedRevision), evidence: decodeRewardClubReviewEvidence(input.evidence), idempotencyKey: key(input.idempotencyKey) };
}
/** Private storage primitive only. Call the verified service for new reviews. */
export async function recordRewardClubReview(identity: RewardAccountIdentity, input: RewardClubReviewInput, rpc?: RewardLedgerRpc) {
  const request = normalizeRewardClubReviewInput(input), s = scope(identity, request.programmeId);
  const result = decodeReview(await call("service_record_reward_club_review", { ...s, p_request_id: request.requestId,
    p_expected_identity_fingerprint: request.expectedIdentityFingerprintSha256, p_expected_revision: request.expectedRevision,
    p_evidence: request.evidence, p_idempotency_key: request.idempotencyKey }, rpc), s.p_programme_id, s.p_actor_user_id);
  demand(result.requestId === request.requestId && result.revision === request.expectedRevision + 1 && result.identityFingerprintSha256 === request.expectedIdentityFingerprintSha256
    && result.idempotencyKey === request.idempotencyKey && JSON.stringify(result.evidence) === JSON.stringify(request.evidence));
  return result;
}
export async function revokeRewardClubReview(identity: RewardAccountIdentity, input: { programmeId: string; reviewId: string; reason: RewardClubReviewRevocationReason }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.programmeId), reviewId = uuid(input.reviewId), why = reason(input.reason);
  const result = decodeReview(await call("service_revoke_reward_club_review", { ...s, p_review_id: reviewId, p_reason: why }, rpc), s.p_programme_id, s.p_actor_user_id);
  demand(result.reviewId === reviewId && result.revokedAt !== null && result.revocationReason === why); return result;
}
