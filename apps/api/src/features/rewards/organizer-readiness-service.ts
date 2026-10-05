import { requireReward } from "@raceson/domain/rewards";
import { readRewardAthleteReviewContext, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardAthleteReadinessReview, type RewardLedgerRpc,
  type RewardReadinessRevocationReason } from "@raceson/db/rewards";
import { reviewAthleteRewardReadiness, revokeAthleteRewardReadiness } from "./athlete-readiness-service.js";
import type { RewardPortalConfig } from "./request-identity.js";

type Options = RewardPortalConfig & { rpc?: RewardLedgerRpc };
type Scope = { programmeId: string; requestId: string };
const actor = (identity: RewardAccountIdentity) => ({ userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) });
const scope = (input: Scope) => ({ programmeId: uuid(input.programmeId), requestId: uuid(input.requestId) });

/** Browser-safe historical summary. Do not spread the private record: it also
 * contains actor/session IDs, audit references and retry keys. A recorded review
 * is not a destination activation, a fresh payment approval or a transfer. */
function reviewSummary(review: RewardAthleteReadinessReview | null) {
  return review === null ? null : { reviewId: review.reviewId, revision: review.revision,
    reviewedAt: review.reviewedAt, profileFingerprintSha256: review.profileFingerprintSha256,
    revokedAt: review.revokedAt, revocationReason: review.revocationReason };
}
async function contextFor(identity: RewardAccountIdentity, input: Scope, deps: Options) {
  const context = await readRewardAthleteReviewContext(identity, input.programmeId, input.requestId, deps.rpc);
  requireReward(context.chainId === deps.chainId && context.challenge.origin === deps.origin, "reward_wallet_context_mismatch");
  return context;
}

/** The designated programme operator alone may see the minimum current profile
 * evidence needed for an explicit review. SQL checks session and authority both
 * before and after reading. This never returns the private wallet proof. */
export async function getOrganizerAthleteReadiness(identity: RewardAccountIdentity, input: Scope, options: Options) {
  const fixed = actor(identity), selected = scope(input), deps = { ...options };
  const c = await contextFor(fixed, selected, deps);
  return { ...selected, chainId: c.chainId, athleteProfileId: c.destination.athleteProfileId,
    address: c.destination.address, requestedAt: c.destination.requestedAt, destinationStatus: c.destination.status,
    profileFingerprintSha256: c.profileFingerprintSha256, dateOfBirth: c.dateOfBirth, birthYear: c.birthYear,
    reviewState: c.reviewState, latestReview: reviewSummary(c.latestReview) };
}

export async function recordOrganizerAthleteReadiness(identity: RewardAccountIdentity,
  input: Parameters<typeof reviewAthleteRewardReadiness>[1], options: Options) {
  const fixed = actor(identity), selected = scope(input), deps = { ...options };
  // The private service freezes and verifies the complete attestation before IO.
  // Never replace the operator's expected fingerprint/revision with a fresh read.
  const review = await reviewAthleteRewardReadiness(fixed, { ...input, ...selected }, deps);
  return { ...selected, chainId: deps.chainId, review: reviewSummary(review) };
}

/** Explicit revocation of the selected latest revision. A stale selection must
 * be reviewed again; immutable review identity prevents changing its request.
 * This DB review revocation cannot revoke an already-signed on-chain capability. */
export async function revokeOrganizerAthleteReadiness(identity: RewardAccountIdentity,
  input: Scope & { reviewId: string; reason: RewardReadinessRevocationReason }, options: Options) {
  const fixed = actor(identity), selected = scope(input), reviewId = uuid(input.reviewId), reason = input.reason, deps = { ...options };
  const c = await contextFor(fixed, selected, deps);
  requireReward(c.latestReview?.reviewId === reviewId, "reward_readiness_revision_changed");
  const review = await revokeAthleteRewardReadiness(fixed, { programmeId: selected.programmeId, reviewId, reason }, deps.rpc);
  requireReward(review.requestId === selected.requestId, "invalid_reward_readiness_document");
  return { ...selected, chainId: deps.chainId, review: reviewSummary(review) };
}
