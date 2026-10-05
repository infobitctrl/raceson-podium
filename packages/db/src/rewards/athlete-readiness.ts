import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardWalletChallenge, type RewardAccountIdentity } from "./athlete-wallets.js";
import { decodeRewardAthleteDestination } from "./athlete-destinations.js";

function demand(value: unknown): asserts value {
  if (!value) throw new RewardLedgerStoreError("invalid_reward_readiness_document");
}
function hash(value: unknown): string {
  demand(typeof value === "string" && /^[0-9a-f]{64}$/.test(value)); return value;
}
function stamp(value: unknown): string { parseRewardSourceTimestamp(value); return value as string; }
function date(value: unknown): string {
  demand(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const parsed = new Date(`${value}T00:00:00Z`);
  demand(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value); return value;
}
function key(value: unknown): string { demand(typeof value === "string" && value.length >= 8 && value.length <= 128); return value; }
function revision(value: unknown, minimum = 0): number {
  demand(Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) < 2147483647); return value as number;
}
const reasons = ["identity_uncertain", "age_uncertain", "wallet_security_changed", "operator_correction"] as const;
export type RewardReadinessRevocationReason = typeof reasons[number];
function reason(value: unknown): RewardReadinessRevocationReason {
  demand(reasons.includes(value as RewardReadinessRevocationReason)); return value as RewardReadinessRevocationReason;
}
/** An explicit designated-operator attestation. The refs identify private audit
 * records, not independently verified provider evidence or client assertions. */
export function decodeRewardReadinessAttestation(value: unknown) {
  const a = object(value, ["schemaVersion", "policy", "verifiedDateOfBirth", "identityEvidenceRef", "adultEvidenceRef",
    "walletMfaEvidenceRef", "walletRecoveryEvidenceRef"]);
  demand(a.schemaVersion === 1 && a.policy === "operator-observed-external-wallet-v1");
  return { schemaVersion: 1 as const, policy: "operator-observed-external-wallet-v1" as const,
    verifiedDateOfBirth: date(a.verifiedDateOfBirth), identityEvidenceRef: uuid(a.identityEvidenceRef),
    adultEvidenceRef: uuid(a.adultEvidenceRef), walletMfaEvidenceRef: uuid(a.walletMfaEvidenceRef), walletRecoveryEvidenceRef: uuid(a.walletRecoveryEvidenceRef) };
}
export type RewardReadinessAttestation = ReturnType<typeof decodeRewardReadinessAttestation>;
function decodeReview(value: unknown, programmeId: string, actorUserId: string) {
  const r = object(value, ["reviewId", "programmeId", "requestId", "revision", "reviewedByUserId", "reviewedSessionId", "reviewedAt",
    "profileFingerprintSha256", "attestation", "idempotencyKey", "revokedAt", "revocationReason"]);
  demand(r.programmeId === programmeId && r.reviewedByUserId === actorUserId);
  const reviewedAt = stamp(r.reviewedAt); const revokedAt = r.revokedAt === null ? null : stamp(r.revokedAt);
  const revocationReason = r.revocationReason === null ? null : reason(r.revocationReason);
  demand((revokedAt === null) === (revocationReason === null) && (revokedAt === null || Date.parse(revokedAt) >= Date.parse(reviewedAt)));
  return { reviewId: uuid(r.reviewId), programmeId, requestId: uuid(r.requestId), revision: revision(r.revision, 1),
    reviewedByUserId: actorUserId, reviewedSessionId: uuid(r.reviewedSessionId), reviewedAt, profileFingerprintSha256: hash(r.profileFingerprintSha256),
    attestation: decodeRewardReadinessAttestation(r.attestation), idempotencyKey: key(r.idempotencyKey), revokedAt, revocationReason };
}
export type RewardAthleteReadinessReview = ReturnType<typeof decodeReview>;
const states = ["unreviewed", "reviewed", "revoked", "profile_changed", "identity_hold", "age_hold", "request_withdrawn"] as const;
export type RewardAthleteReviewState = typeof states[number];
const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_readiness_scope_required",
  "invalid_reward_readiness_review", "reward_readiness_revision_changed", "reward_readiness_profile_changed", "reward_readiness_hold", "reward_ledger_idempotency_conflict"]);
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
const scope = (identity: RewardAccountIdentity, programmeId: string) => ({ p_programme_id: uuid(programmeId), p_actor_user_id: uuid(identity.userId), p_actor_session_id: uuid(identity.sessionId) });

/** Private observation, not atomic claim authorization. Contains proof and DOB;
 * never serialize this whole context into a browser response or logs. */
export async function readRewardAthleteReviewContext(identity: RewardAccountIdentity, programmeId: string, requestId: string, rpc?: RewardLedgerRpc) {
  const s = scope(identity, programmeId); const id = uuid(requestId);
  return decodeRewardAthleteReviewContext(await call("service_read_reward_athlete_review_context", { ...s, p_request_id: id }, rpc),
    { userId:s.p_actor_user_id,sessionId:s.p_actor_session_id }, s.p_programme_id, id);
}
export function decodeRewardAthleteReviewContext(value: unknown, identity: RewardAccountIdentity, programmeId: string, requestId: string) {
  const s = scope(identity, programmeId); const id = uuid(requestId);
  return decodeRewardAthleteReviewSubject(value, s.p_actor_user_id, s.p_programme_id, id);
}
/** Pure private subject decoding; performs no RPC or authentication as the operator. */
export function decodeRewardAthleteReviewSubject(value: unknown, operatorUserId: string, programmeId: string, requestId: string) {
  const s = {p_actor_user_id: uuid(operatorUserId), p_programme_id: uuid(programmeId)}; const id = uuid(requestId);
  const c = object(value,
    ["programmeId", "operatorUserId", "chainId", "destination", "challenge", "profileFingerprintSha256", "dateOfBirth", "birthYear", "latestReview", "reviewState"]);
  demand(c.programmeId === s.p_programme_id && c.operatorUserId === s.p_actor_user_id && (c.chainId === 10143 || c.chainId === 31337));
  // Decode identities from a strict private document, never a request body.
  const raw = object(c.destination, ["requestId", "userId", "sessionId", "athleteProfileId", "proofId", "address", "chainId", "requestedAt", "idempotencyKey", "withdrawnAt", "status"]);
  const destination = decodeRewardAthleteDestination(raw, uuid(raw.userId));
  const challenge = decodeRewardWalletChallenge(c.challenge, { userId: destination.userId, sessionId: destination.sessionId });
  demand(destination.requestId === id && destination.chainId === c.chainId && challenge.chainId === c.chainId
    && destination.address === challenge.address && destination.proofId === challenge.proof?.proofId);
  const profileFingerprintSha256 = hash(c.profileFingerprintSha256);
  const dateOfBirth = c.dateOfBirth === null ? null : date(c.dateOfBirth);
  demand(c.birthYear === null || (Number.isSafeInteger(c.birthYear) && (c.birthYear as number) >= 1000 && (c.birthYear as number) <= 9999));
  const latestReview = c.latestReview === null ? null : decodeReview(c.latestReview, s.p_programme_id, s.p_actor_user_id);
  demand(latestReview === null || latestReview.requestId === id);
  demand(states.includes(c.reviewState as RewardAthleteReviewState));
  const reviewState = c.reviewState as RewardAthleteReviewState;
  if (reviewState === "reviewed") demand(latestReview !== null && latestReview.revokedAt === null
    && latestReview.profileFingerprintSha256 === profileFingerprintSha256 && dateOfBirth === latestReview.attestation.verifiedDateOfBirth
    && destination.status === "pending_review");
  if (reviewState === "unreviewed") demand(latestReview === null);
  if (reviewState === "revoked") demand(latestReview?.revokedAt != null);
  if (reviewState === "profile_changed") demand(latestReview !== null && latestReview.profileFingerprintSha256 !== profileFingerprintSha256);
  if (reviewState === "request_withdrawn") demand(destination.status === "withdrawn");
  return { programmeId: s.p_programme_id, operatorUserId: s.p_actor_user_id, chainId: c.chainId as 10143 | 31337,
    destination, challenge, profileFingerprintSha256, dateOfBirth, birthYear: c.birthYear as number | null, latestReview, reviewState };
}
export type RewardAthleteReviewContext = Awaited<ReturnType<typeof readRewardAthleteReviewContext>>;
export async function recordRewardAthleteReview(identity: RewardAccountIdentity, input: {
  programmeId: string; requestId: string; expectedProfileFingerprintSha256: string; expectedRevision: number;
  attestation: unknown; idempotencyKey: string;
}, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.programmeId); const requestId = uuid(input.requestId);
  const fingerprint = hash(input.expectedProfileFingerprintSha256); const expectedRevision = revision(input.expectedRevision);
  const attestation = decodeRewardReadinessAttestation(input.attestation); const idempotencyKey = key(input.idempotencyKey);
  const result = decodeReview(await call("service_record_reward_athlete_review", { ...s, p_request_id: requestId,
    p_expected_profile_fingerprint: fingerprint, p_expected_revision: expectedRevision, p_attestation: attestation, p_idempotency_key: idempotencyKey }, rpc), s.p_programme_id, s.p_actor_user_id);
  demand(result.requestId === requestId && result.profileFingerprintSha256 === fingerprint && result.revision === expectedRevision + 1
    && result.idempotencyKey === idempotencyKey && JSON.stringify(result.attestation) === JSON.stringify(attestation));
  return result;
}
export async function revokeRewardAthleteReview(identity: RewardAccountIdentity, input: {
  programmeId: string; reviewId: string; reason: RewardReadinessRevocationReason;
}, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.programmeId); const reviewId = uuid(input.reviewId); const why = reason(input.reason);
  const result = decodeReview(await call("service_revoke_reward_athlete_review", { ...s, p_review_id: reviewId, p_reason: why }, rpc), s.p_programme_id, s.p_actor_user_id);
  demand(result.reviewId === reviewId && result.revokedAt !== null && result.revocationReason === why); return result;
}
