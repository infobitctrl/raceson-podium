import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { clubSafeDeploymentFixture } from "../../../../packages/rewards-chain/test/club-safe-deployment-fixture.mjs";
export const clubReviewId = n => `7c200000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const id = clubReviewId;
export function clubReviewFixture() {
  const chain = clubSafeDeploymentFixture(), identity = { userId: id(1), sessionId: id(2) };
  const candidate = { safeAddress: chain.input.safe.context.verifyingContract.toLowerCase(), singletonAddress: chain.input.safe.singletonAddress.toLowerCase(),
    fallbackHandlerAddress: chain.input.safe.fallbackHandlerAddress.toLowerCase(), owners: chain.input.safe.owners.map(a => a.toLowerCase()).sort() };
  const block = b => ({ number: b.number.toString(), hash: b.hash, timestamp: b.timestamp.toString() });
  const evidence = { schemaVersion: 1, policy: "operator-reviewed-original-safe-v1", chainId: 31337, candidate,
    factoryAddress: chain.input.factoryAddress.toLowerCase(), deploymentTransactionHash: chain.input.deploymentTransactionHash,
    deploymentBlock: block(chain.deployment), reviewedBlock: block(chain.at), initializerHash: keccak256(chain.initializer),
    authorityEvidenceRef: id(10), controlEvidenceRef: id(11), recoveryEvidenceRef: id(12), executionHistoryEvidenceRef: id(13) };
  const nomination = { requestId: id(4), userId: id(5), sessionId: id(6), clubId: id(7), chainId: 31337, candidate,
    requestedAt: "2026-09-09T01:00:00Z", idempotencyKey: "synthetic-club-choice", withdrawnAt: null, status: "pending_review" };
  const context = { programmeId: id(3), operatorUserId: id(1), chainId: 31337, nomination, identityFingerprintSha256: "a".repeat(64),
    latestReview: null, retryReview: null, reviewState: "unreviewed" };
  const input = { programmeId: id(3), requestId: id(4), expectedIdentityFingerprintSha256: "a".repeat(64), expectedRevision: 0,
    evidence: structuredClone(evidence), idempotencyKey: "synthetic-club-review" };
  const review = { reviewId: id(8), programmeId: id(3), requestId: id(4), revision: 1, reviewedByUserId: id(1), reviewedSessionId: id(2),
    reviewedAt: "2026-09-09T01:00:01Z", identityFingerprintSha256: "a".repeat(64), evidence: structuredClone(evidence),
    idempotencyKey: input.idempotencyKey, revokedAt: null, revocationReason: null };
  const calls = [], rpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    assert.equal(args.p_actor_user_id, identity.userId); assert.equal(args.p_actor_session_id, identity.sessionId); assert.equal(args.p_programme_id, input.programmeId);
    if (name === "service_read_reward_club_review_context") return { data: structuredClone(context), error: null };
    if (name === "service_revoke_reward_club_review") return { data: { ...structuredClone(review), revokedAt: "2026-09-09T01:00:02Z", revocationReason: args.p_reason }, error: null };
    assert.equal(name, "service_record_reward_club_review"); return { data: structuredClone(review), error: null };
  };
  return { chain, identity, input, review, context, calls, rpc, deps: { chainId: 31337, reader: chain.reader, rpc } };
}
