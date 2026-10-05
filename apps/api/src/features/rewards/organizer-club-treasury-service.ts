import { requireReward } from "@raceson/domain/rewards";
import { readRewardOperatorClubTreasury, readRewardClubReviewContext, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardClubReviewInput, type RewardClubTreasuryReview, type RewardLedgerRpc, type RewardClubReviewRevocationReason } from "@raceson/db/rewards";
import { readVerifiedRewardClubSafeDeployment, type RewardClubSafeDeploymentReader } from "@raceson/rewards-chain";
import { reviewClubRewardTreasury, revokeClubRewardTreasuryReview } from "./club-treasury-review-service.js";
import type { RewardPortalConfig } from "./request-identity.js";
type Scope = { programmeId: string; requestId: string };
type Options = RewardPortalConfig & { rpc?: RewardLedgerRpc; reader: RewardClubSafeDeploymentReader | (() => RewardClubSafeDeploymentReader) };
const actor = (i: RewardAccountIdentity) => ({ userId: uuid(i.userId), sessionId: uuid(i.sessionId) });
const scope = (s: Scope) => ({ programmeId: uuid(s.programmeId), requestId: uuid(s.requestId) });
const summary = (r: RewardClubTreasuryReview | null) => r === null ? null : ({ reviewId: r.reviewId, revision: r.revision,
  reviewedAt: r.reviewedAt, identityFingerprintSha256: r.identityFingerprintSha256, revokedAt: r.revokedAt, revocationReason: r.revocationReason });

/** Explicit browser whitelist: no user/session IDs, evidence refs, signatures or
 * idempotency keys. Nominee display data is current metadata, not ownership proof. */
export async function getOrganizerClubTreasury(identity: RewardAccountIdentity, input: Scope, options: RewardPortalConfig & { rpc?: RewardLedgerRpc }) {
  const fixed = actor(identity), selected = scope(input), deps = { ...options };
  const { context: c, labels } = await readRewardOperatorClubTreasury(fixed, { ...selected, chainId: deps.chainId }, deps.rpc);
  return { ...selected, chainId: c.chainId, clubId: c.nomination.clubId, ...labels, candidate: c.nomination.candidate,
    requestedAt: c.nomination.requestedAt, nominationStatus: c.nomination.status, identityFingerprintSha256: c.identityFingerprintSha256,
    reviewState: c.reviewState, latestReview: summary(c.latestReview) };
}
/** Read-only preview selected before human review. Saving later must reverify
 * this exact checkpoint and the original identity/revision, never auto-refresh. */
export async function observeOrganizerClubTreasury(identity: RewardAccountIdentity, input: Scope & {
  expectedIdentityFingerprintSha256: string; expectedRevision: number; factoryAddress: `0x${string}`; deploymentTransactionHash: `0x${string}`;
}, options: Options) {
  const fixed = actor(identity), selected = scope(input), expected = { fingerprint: input.expectedIdentityFingerprintSha256,
    revision: input.expectedRevision, factoryAddress: input.factoryAddress, deploymentTransactionHash: input.deploymentTransactionHash }, deps = { ...options };
  requireReward(/^[0-9a-f]{64}$/.test(expected.fingerprint) && Number.isSafeInteger(expected.revision) && expected.revision >= 0 && expected.revision < 2147483646,
    "invalid_reward_club_review");
  const current = () => readRewardClubReviewContext(fixed, selected.programmeId, selected.requestId, deps.rpc);
  const validate = (c: Awaited<ReturnType<typeof current>>) => {
    requireReward(c.chainId === deps.chainId, "reward_club_review_scope_required");
    requireReward(!["identity_hold", "request_withdrawn"].includes(c.reviewState), "reward_club_review_hold");
    requireReward(c.identityFingerprintSha256 === expected.fingerprint, "reward_club_review_identity_changed");
    requireReward((c.latestReview?.revision ?? 0) === expected.revision, "reward_club_review_revision_changed");
  };
  const c = await current(); validate(c); const candidate = c.nomination.candidate;
  const observed = await readVerifiedRewardClubSafeDeployment(typeof deps.reader === "function" ? deps.reader() : deps.reader, {
    safe: { context: { environment: deps.chainId === 31337 ? "local-simulation" : "monad-testnet", chainId: deps.chainId, verifyingContract: candidate.safeAddress },
      singletonAddress: candidate.singletonAddress, fallbackHandlerAddress: candidate.fallbackHandlerAddress, owners: candidate.owners },
    factoryAddress: expected.factoryAddress, deploymentTransactionHash: expected.deploymentTransactionHash,
  });
  validate(await current()); // Do not return a preview after ownership/session loss during RPC.
  const wire = (b: { number: bigint; timestamp: bigint; hash: `0x${string}` }) => ({ number: b.number.toString(), timestamp: b.timestamp.toString(), hash: b.hash });
  return { ...selected, chainId: deps.chainId, expectedIdentityFingerprintSha256: expected.fingerprint, expectedRevision: expected.revision,
    candidate, factoryAddress: expected.factoryAddress.toLowerCase(), deploymentTransactionHash: expected.deploymentTransactionHash.toLowerCase(),
    initializerHash: observed.initializerHash, deploymentBlock: wire(observed.deploymentBlock), reviewedBlock: wire(observed.safe.finalizedBlock),
    scope: "initialization_only" as const, executionHistoryReviewRequired: true as const };
}
export async function recordOrganizerClubTreasuryReview(identity: RewardAccountIdentity, input: RewardClubReviewInput, options: Options) {
  const fixed = actor(identity), selected = scope(input), deps = { ...options };
  const r = await reviewClubRewardTreasury(fixed, { ...input, ...selected }, deps);
  return { ...selected, chainId: deps.chainId, review: summary(r) };
}
export async function revokeOrganizerClubTreasuryReview(identity: RewardAccountIdentity,
  input: Scope & { reviewId: string; reason: RewardClubReviewRevocationReason }, options: RewardPortalConfig & { rpc?: RewardLedgerRpc }) {
  const fixed = actor(identity), selected = scope(input), reviewId = uuid(input.reviewId), reason = input.reason, deps = { ...options };
  const c = await readRewardClubReviewContext(fixed, selected.programmeId, selected.requestId, deps.rpc);
  requireReward(c.chainId === deps.chainId, "reward_club_review_scope_required");
  requireReward(c.latestReview?.reviewId === reviewId, "reward_club_review_revision_changed");
  const r = await revokeClubRewardTreasuryReview(fixed, { programmeId: selected.programmeId, reviewId, reason }, deps.rpc);
  requireReward(r.requestId === selected.requestId, "invalid_reward_operator_club_document");
  return { ...selected, chainId: deps.chainId, review: summary(r) };
}
