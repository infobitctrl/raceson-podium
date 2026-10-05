import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardClubTreasuryDocument } from "./club-treasuries.js";
import { decodeRewardClubReviewEvidence, type RewardClubReviewRevocationReason } from "./club-treasury-reviews.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

export type ClubReadinessScopeV3 = { chainId: 31337 | 10143; uploadId: string; requestId: string; role: "recipient" | "operator" };
const states = ["request_withdrawn","identity_hold","source_hold","unreviewed","revoked","identity_changed","reviewed"] as const;
const reasons = ["authority_uncertain","key_control_changed","wallet_history_uncertain","operator_correction"] as const;
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_club_readiness_v3"); }
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const stamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
function scope(identity: RewardAccountIdentity, input: ClubReadinessScopeV3) {
  check([31337,10143].includes(input.chainId) && ["recipient","operator"].includes(input.role));
  return { actor: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) },
    input: { chainId: input.chainId, uploadId: uuid(input.uploadId), requestId: uuid(input.requestId), role: input.role } };
}
export function decodeClubReadinessReviewV3(raw: unknown) {
  const r = object(raw, ["id","uploadId","requestId","previousReviewId","sourceGuardHash","identityFingerprint","evidence",
    "reviewedByUserId","reviewedSessionId","reviewedAt","revocation"]);
  let revocation = null;
  if (r.revocation !== null) {
    const v = object(r.revocation, ["reason","revokedAt","revokedByUserId"]);
    check(reasons.includes(v.reason as typeof reasons[number]));
    revocation = { reason: v.reason as RewardClubReviewRevocationReason, revokedAt: stamp(v.revokedAt), revokedByUserId: uuid(v.revokedByUserId) };
    check(Date.parse(revocation.revokedAt) >= Date.parse(stamp(r.reviewedAt)));
  }
  check(r.previousReviewId !== r.id);
  return { id: uuid(r.id), uploadId: uuid(r.uploadId), requestId: uuid(r.requestId), previousReviewId: r.previousReviewId === null ? null : uuid(r.previousReviewId),
    sourceGuardHash: hash(r.sourceGuardHash), identityFingerprint: hash(r.identityFingerprint), evidence: decodeRewardClubReviewEvidence(r.evidence),
    reviewedByUserId: uuid(r.reviewedByUserId), reviewedSessionId: uuid(r.reviewedSessionId), reviewedAt: stamp(r.reviewedAt), revocation };
}
export function decodeClubReadinessContextV3(raw: unknown, identity: RewardAccountIdentity, input: ClubReadinessScopeV3, retryId: string | null = null) {
  const c = object(raw, ["schema","actorUserId","role","source","nomination","identityFingerprint","state","review","retryReview"]);
  check(c.schema === "raceson-club-readiness-private-v3" && c.actorUserId === identity.userId && c.role === input.role);
  const s = object(c.source, ["draftId","chainId","uploadId","approvalId","slot","operatorUserId","operatorAddress","current","sourceGuardHash"]);
  check(s.chainId === input.chainId && s.uploadId === input.uploadId && typeof s.current === "boolean"
    && Number.isInteger(s.slot) && Number(s.slot) >= 1 && Number(s.slot) <= 6
    && typeof s.operatorAddress === "string" && /^0x[0-9a-f]{40}$/.test(s.operatorAddress) && BigInt(s.operatorAddress) > 1n);
  const source = { draftId: uuid(s.draftId), chainId: input.chainId, uploadId: uuid(s.uploadId), approvalId: uuid(s.approvalId), slot: Number(s.slot),
    operatorUserId: uuid(s.operatorUserId), operatorAddress: s.operatorAddress as `0x${string}`, current: s.current, sourceGuardHash: hash(s.sourceGuardHash) };
  const rawNomination = c.nomination as { userId?: unknown };
  const nomination = decodeRewardClubTreasuryDocument(c.nomination, { userId: uuid(rawNomination?.userId), chainId: input.chainId });
  check(nomination.requestId === input.requestId && identity.userId === (input.role === "operator" ? source.operatorUserId : nomination.userId));
  const review = c.review === null ? null : decodeClubReadinessReviewV3(c.review);
  const retryReview = c.retryReview === null ? null : decodeClubReadinessReviewV3(c.retryReview);
  const identityFingerprint = hash(c.identityFingerprint);
  for (const r of [review,retryReview]) if (r) check(r.uploadId === input.uploadId && r.requestId === input.requestId
    && r.reviewedByUserId === source.operatorUserId && r.evidence.chainId === input.chainId
    && JSON.stringify(r.evidence.candidate) === JSON.stringify(nomination.candidate));
  check(!retryReview || retryId !== null && retryReview.id === retryId);
  check(states.includes(c.state as typeof states[number]));
  if (c.state === "reviewed") check(review && !review.revocation && source.current && review.sourceGuardHash === source.sourceGuardHash
    && review.identityFingerprint === identityFingerprint && nomination.status === "pending_review");
  if (c.state === "unreviewed") check(review === null && source.current && nomination.status === "pending_review");
  if (c.state === "revoked") check(review?.revocation);
  if (c.state === "identity_changed") check(review && review.identityFingerprint !== identityFingerprint);
  if (c.state === "request_withdrawn") check(nomination.status === "withdrawn");
  if (c.state === "source_hold") check(!source.current || review && review.sourceGuardHash !== source.sourceGuardHash);
  return { schema: "raceson-club-readiness-private-v3" as const, actorUserId: identity.userId, role: input.role,
    source, nomination, identityFingerprint, state: c.state as typeof states[number], review, retryReview };
}
export type ClubReadinessContextV3 = ReturnType<typeof decodeClubReadinessContextV3>;
const safe = new Set(["reward_account_session_required","reward_club_readiness_scope_required","reward_club_readiness_revision_changed",
  "reward_club_readiness_identity_changed","reward_planning_revision_changed","reward_club_readiness_hold","invalid_reward_club_readiness","reward_ledger_idempotency_conflict"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) {
    const message = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safe.has(message) ? message : "reward_ledger_store_failed");
  }
  return copy(result.data);
}
const args = (s: ReturnType<typeof scope>) => ({ p_actor_user_id: s.actor.userId, p_actor_session_id: s.actor.sessionId,
  p_chain_id: s.input.chainId, p_upload_id: s.input.uploadId, p_request_id: s.input.requestId });
/** Private account IDs, history and human evidence references; never HTTP. */
export async function readClubReadinessV3(identity: RewardAccountIdentity, input: ClubReadinessScopeV3, rpc?: RewardLedgerRpc, retryId: string | null = null) {
  const s = scope(identity,input), id = retryId === null ? null : uuid(retryId);
  return decodeClubReadinessContextV3(await call("service_read_reward_club_readiness_v3", { ...args(s), p_role: s.input.role, p_review_id: id }, rpc), s.actor,s.input,id);
}
export type ClubReadinessReviewInputV3 = Omit<ClubReadinessScopeV3,"role"> & {
  reviewId: string; previousReviewId: string | null; sourceGuardHash: string; identityFingerprint: string; evidence: unknown };
export function normalizeClubReadinessReviewInputV3(input: ClubReadinessReviewInputV3) {
  check([31337,10143].includes(input.chainId));
  return { chainId: input.chainId, uploadId: uuid(input.uploadId), requestId: uuid(input.requestId), reviewId: uuid(input.reviewId),
    previousReviewId: input.previousReviewId === null ? null : uuid(input.previousReviewId), sourceGuardHash: hash(input.sourceGuardHash),
    identityFingerprint: hash(input.identityFingerprint), evidence: decodeRewardClubReviewEvidence(input.evidence) };
}
/** Service-only persistence; new writes must go through chain verification. */
export async function recordClubReadinessV3(identity: RewardAccountIdentity, input: ClubReadinessReviewInputV3, rpc?: RewardLedgerRpc) {
  const p = normalizeClubReadinessReviewInputV3(input), s = scope(identity,{...p,role:"operator"});
  const r = decodeClubReadinessReviewV3(await call("service_record_reward_club_readiness_v3", { ...args(s), p_review_id: p.reviewId,
    p_previous_review_id: p.previousReviewId,p_source_guard_hash:p.sourceGuardHash,p_identity_fingerprint:p.identityFingerprint,p_evidence:p.evidence },rpc));
  check(r.id === p.reviewId && r.uploadId === p.uploadId && r.requestId === p.requestId && r.previousReviewId === p.previousReviewId
    && r.sourceGuardHash === p.sourceGuardHash && r.identityFingerprint === p.identityFingerprint && r.reviewedByUserId === s.actor.userId
    && JSON.stringify(r.evidence) === JSON.stringify(p.evidence)); return r;
}
export async function revokeClubReadinessV3(identity: RewardAccountIdentity, input: Omit<ClubReadinessScopeV3,"role"> & {
  reviewId: string; reason: RewardClubReviewRevocationReason }, rpc?: RewardLedgerRpc) {
  const s = scope(identity,{...input,role:"operator"}), id=uuid(input.reviewId), reason=input.reason;
  check(reasons.includes(reason));
  const r = decodeClubReadinessReviewV3(await call("service_revoke_reward_club_readiness_v3", { ...args(s),p_review_id:id,p_reason:reason },rpc));
  check(r.id === id && r.uploadId === s.input.uploadId && r.requestId === s.input.requestId
    && r.revocation?.reason === reason && r.revocation.revokedByUserId === s.actor.userId); return r;
}
