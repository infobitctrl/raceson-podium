import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardAthleteDestination } from "./athlete-destinations.js";
import { decodeRewardWalletChallenge, type RewardAccountIdentity } from "./athlete-wallets.js";
import { type RewardReadinessRevocationReason } from "./athlete-readiness.js";
import { decodeRewardReadinessAttestationV3, requireReadinessPolicyChainV3 } from "./privy-readiness-policy-v3.js";

export type ReadinessScopeV3 = { chainId: 31337 | 10143; uploadId: string; destinationId: string; role: "recipient" | "operator" };
const states = ["request_withdrawn", "identity_hold", "age_hold", "source_hold", "unreviewed", "revoked", "profile_changed", "reviewed"] as const;
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_readiness_v3"); }
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const stamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
function date(v: unknown) {
  check(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const parsed = new Date(`${v}T00:00:00Z`);
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v); return v;
}
function scope(identity: RewardAccountIdentity, input: ReadinessScopeV3) {
  check([31337, 10143].includes(input.chainId) && ["recipient", "operator"].includes(input.role));
  return { actor: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) },
    input: { chainId: input.chainId, uploadId: uuid(input.uploadId), destinationId: uuid(input.destinationId), role: input.role } };
}
export function decodeReadinessReviewV3(raw: unknown) {
  const r = object(raw, ["id", "uploadId", "destinationId", "previousReviewId", "sourceGuardHash", "profileFingerprint", "attestation",
    "reviewedByUserId", "reviewedSessionId", "reviewedAt", "revocation"]);
  let revocation = null;
  if (r.revocation !== null) {
    const v = object(r.revocation, ["reason", "revokedAt", "revokedByUserId"]);
    check(["identity_uncertain", "age_uncertain", "wallet_security_changed", "operator_correction"].includes(String(v.reason)));
    revocation = { reason: v.reason as RewardReadinessRevocationReason, revokedAt: stamp(v.revokedAt), revokedByUserId: uuid(v.revokedByUserId) };
    check(Date.parse(revocation.revokedAt) >= Date.parse(stamp(r.reviewedAt)));
  }
  check(r.previousReviewId !== r.id);
  return { id: uuid(r.id), uploadId: uuid(r.uploadId), destinationId: uuid(r.destinationId), previousReviewId: r.previousReviewId === null ? null : uuid(r.previousReviewId),
    sourceGuardHash: hash(r.sourceGuardHash), profileFingerprint: hash(r.profileFingerprint), attestation: decodeRewardReadinessAttestationV3(r.attestation),
    reviewedByUserId: uuid(r.reviewedByUserId), reviewedSessionId: uuid(r.reviewedSessionId), reviewedAt: stamp(r.reviewedAt), revocation };
}
export function decodeReadinessContextV3(raw: unknown, identity: RewardAccountIdentity, input: ReadinessScopeV3) {
  const c = object(raw, ["schema", "actorUserId", "role", "source", "destination", "challenge", "profileFingerprint", "dateOfBirth", "birthYear", "state", "review"]);
  check(c.schema === "raceson-athlete-readiness-private-v3" && c.actorUserId === identity.userId && c.role === input.role);
  const s = object(c.source, ["draftId", "chainId", "uploadId", "approvalId", "slot", "operatorUserId", "operatorAddress", "current", "sourceGuardHash"]);
  check(s.chainId === input.chainId && s.uploadId === input.uploadId && typeof s.current === "boolean"
    && Number.isInteger(s.slot) && Number(s.slot) >= 1 && Number(s.slot) <= 6
    && typeof s.operatorAddress === "string" && /^0x[0-9a-f]{40}$/.test(s.operatorAddress) && BigInt(s.operatorAddress) > 0n);
  const source = { draftId: uuid(s.draftId), chainId: input.chainId, uploadId: uuid(s.uploadId), approvalId: uuid(s.approvalId), slot: Number(s.slot),
    operatorUserId: uuid(s.operatorUserId), operatorAddress: s.operatorAddress as `0x${string}`, current: s.current, sourceGuardHash: hash(s.sourceGuardHash) };
  const rawDest = c.destination as { userId?: unknown };
  const destination = decodeRewardAthleteDestination(c.destination, uuid(rawDest?.userId));
  check(destination.requestId === input.destinationId && destination.chainId === input.chainId
    && identity.userId === (input.role === "operator" ? source.operatorUserId : destination.userId));
  const challenge = decodeRewardWalletChallenge(c.challenge, { userId: destination.userId, sessionId: destination.sessionId });
  check(challenge.proof?.proofId === destination.proofId && challenge.address === destination.address && challenge.chainId === input.chainId);
  check(states.includes(c.state as typeof states[number]));
  const dateOfBirth = c.dateOfBirth === null ? null : date(c.dateOfBirth);
  check(c.birthYear === null || Number.isInteger(c.birthYear) && Number(c.birthYear) >= 1900 && Number(c.birthYear) <= 2200);
  const review = c.review === null ? null : decodeReadinessReviewV3(c.review), profileFingerprint = hash(c.profileFingerprint);
  if (review) check(review.uploadId === input.uploadId && review.destinationId === input.destinationId && review.reviewedByUserId === source.operatorUserId);
  if (review) requireReadinessPolicyChainV3(review.attestation, input.chainId);
  if (c.state === "reviewed") check(review && !review.revocation && review.profileFingerprint === profileFingerprint
    && source.current && review.sourceGuardHash === source.sourceGuardHash
    && (review.attestation.schemaVersion === 3
      ? source.draftId === review.attestation.draftId && destination.athleteProfileId === review.attestation.athleteProfileId
        && dateOfBirth === null && c.birthYear === null
      : review.attestation.verifiedDateOfBirth === c.dateOfBirth)
    && destination.status === "pending_review");
  if (c.state === "unreviewed") check(review === null && source.current && destination.status === "pending_review");
  if (c.state === "revoked") check(review?.revocation);
  if (c.state === "profile_changed") check(review && review.profileFingerprint !== profileFingerprint);
  if (c.state === "request_withdrawn") check(destination.status === "withdrawn");
  if (c.state === "source_hold") check(!source.current || review && review.sourceGuardHash !== source.sourceGuardHash);
  return { schema: "raceson-athlete-readiness-private-v3" as const, actorUserId: identity.userId, role: input.role, source, destination, challenge,
    profileFingerprint, dateOfBirth, birthYear: c.birthYear as number | null,
    state: c.state as typeof states[number], review };
}
export type ReadinessContextV3 = ReturnType<typeof decodeReadinessContextV3>;
const safe = new Set(["reward_account_session_required", "reward_readiness_scope_required", "reward_readiness_revision_changed",
  "reward_readiness_profile_changed", "reward_planning_revision_changed", "reward_readiness_hold", "invalid_reward_readiness_review", "reward_ledger_idempotency_conflict"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) { const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_store_failed"); }
  return copy(result.data);
}
const args = (s: ReturnType<typeof scope>) => ({ p_actor_user_id: s.actor.userId, p_actor_session_id: s.actor.sessionId,
  p_chain_id: s.input.chainId, p_upload_id: s.input.uploadId, p_destination_id: s.input.destinationId });
/** Contains private DOB, wallet signature and evidence references. Never HTTP. */
export async function readReadinessV3(identity: RewardAccountIdentity, input: ReadinessScopeV3, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input); return decodeReadinessContextV3(await call("service_read_reward_readiness_v3", { ...args(s), p_role: s.input.role }, rpc), s.actor, s.input);
}
export async function recordReadinessV3(identity: RewardAccountIdentity, input: Omit<ReadinessScopeV3, "role"> & {
  reviewId: string; previousReviewId: string | null; sourceGuardHash: string; profileFingerprint: string; attestation: unknown }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, { ...input, role: "operator" }), reviewId = uuid(input.reviewId), previous = input.previousReviewId === null ? null : uuid(input.previousReviewId);
  const guard = hash(input.sourceGuardHash), fingerprint = hash(input.profileFingerprint), attestation = decodeRewardReadinessAttestationV3(input.attestation);
  requireReadinessPolicyChainV3(attestation, s.input.chainId);
  const r = decodeReadinessReviewV3(await call("service_record_reward_readiness_v3", { ...args(s), p_review_id: reviewId, p_previous_review_id: previous,
    p_source_guard_hash: guard, p_profile_fingerprint: fingerprint, p_attestation: attestation }, rpc));
  check(r.id === reviewId && r.uploadId === s.input.uploadId && r.destinationId === s.input.destinationId && r.previousReviewId === previous
    && r.reviewedByUserId === s.actor.userId && r.sourceGuardHash === guard && r.profileFingerprint === fingerprint
    && JSON.stringify(r.attestation) === JSON.stringify(attestation)); return r;
}
export async function revokeReadinessV3(identity: RewardAccountIdentity, input: Omit<ReadinessScopeV3, "role"> & {
  reviewId: string; reason: RewardReadinessRevocationReason }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, { ...input, role: "operator" }), reviewId = uuid(input.reviewId);
  check(["identity_uncertain", "age_uncertain", "wallet_security_changed", "operator_correction"].includes(input.reason));
  const r = decodeReadinessReviewV3(await call("service_revoke_reward_readiness_v3", { ...args(s), p_review_id: reviewId, p_reason: input.reason }, rpc));
  check(r.id === reviewId && r.uploadId === s.input.uploadId && r.destinationId === s.input.destinationId
    && r.revocation?.reason === input.reason && r.revocation.revokedByUserId === s.actor.userId); return r;
}
