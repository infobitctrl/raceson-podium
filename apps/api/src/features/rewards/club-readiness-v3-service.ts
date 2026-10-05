import { requireReward } from "@raceson/domain/rewards";
import { readClubReadinessV3, recordClubReadinessV3, revokeClubReadinessV3, normalizeClubReadinessReviewInputV3,
  rewardDocumentUuid as uuid, type RewardAccountIdentity, type ClubReadinessScopeV3, type ClubReadinessReviewInputV3,
  type RewardClubReviewRevocationReason, type RewardLedgerRpc } from "@raceson/db/rewards";
import { readVerifiedRewardClubSafeDeployment, type RewardClubSafeDeploymentReader } from "@raceson/rewards-chain";

export type ClubReadinessDependenciesV3 = { chainId: 31337 | 10143; rpc?: RewardLedgerRpc;
  reader?: RewardClubSafeDeploymentReader | (() => RewardClubSafeDeploymentReader) };
const actor = (i: RewardAccountIdentity) => ({userId:uuid(i.userId),sessionId:uuid(i.sessionId)});
export type ClubObservationRequestV3 = {
  sourceGuardHash: string; identityFingerprint: string; previousReviewId: string | null;
  factoryAddress: `0x${string}`; deploymentTransactionHash: `0x${string}`;
};
/** Read-only, upload-scoped inspection. Human authority/control/history evidence
 * is deliberately absent; initialization provenance cannot establish it. */
export async function observeClubReadinessV3(identity: RewardAccountIdentity,
  input: { uploadId: string; requestId: string } & ClubObservationRequestV3, deps: ClubReadinessDependenciesV3) {
  const fixed = actor(identity), scope = { chainId: deps.chainId, uploadId: uuid(input.uploadId), requestId: uuid(input.requestId), role: "operator" as const };
  const expected = { sourceGuardHash: input.sourceGuardHash, identityFingerprint: input.identityFingerprint,
    previousReviewId: input.previousReviewId === null ? null : uuid(input.previousReviewId),
    factoryAddress: input.factoryAddress, deploymentTransactionHash: input.deploymentTransactionHash };
  requireReward(/^[0-9a-f]{64}$/.test(expected.sourceGuardHash) && /^[0-9a-f]{64}$/.test(expected.identityFingerprint)
    && /^0x[0-9a-f]{40}$/.test(expected.factoryAddress) && /^0x[0-9a-f]{64}$/.test(expected.deploymentTransactionHash), "invalid_reward_club_readiness_v3");
  const current = () => readClubReadinessV3(fixed, scope, deps.rpc);
  const validate = (c: Awaited<ReturnType<typeof current>>) => {
    requireReward(c.source.current && !["request_withdrawn", "identity_hold", "source_hold"].includes(c.state), "reward_club_readiness_hold");
    requireReward(c.source.sourceGuardHash === expected.sourceGuardHash, "reward_planning_revision_changed");
    requireReward(c.identityFingerprint === expected.identityFingerprint, "reward_club_readiness_identity_changed");
    requireReward((c.review?.id ?? null) === expected.previousReviewId, "reward_club_readiness_revision_changed");
  };
  const c = await current(); validate(c);
  requireReward(deps.reader, "reward_club_reader_required");
  const candidate = c.nomination.candidate;
  const observed = await readVerifiedRewardClubSafeDeployment(typeof deps.reader === "function" ? deps.reader() : deps.reader, {
    safe: { context: { environment: scope.chainId === 31337 ? "local-simulation" : "monad-testnet", chainId: scope.chainId,
      verifyingContract: candidate.safeAddress }, singletonAddress: candidate.singletonAddress,
      fallbackHandlerAddress: candidate.fallbackHandlerAddress, owners: candidate.owners },
    factoryAddress: expected.factoryAddress, deploymentTransactionHash: expected.deploymentTransactionHash,
  });
  const after = await current(); validate(after);
  requireReward(JSON.stringify(after.nomination.candidate) === JSON.stringify(candidate)
    && after.state === c.state, "reward_club_readiness_revision_changed");
  const wire = (b: { number: bigint; hash: `0x${string}`; timestamp: bigint }) => ({ number: b.number.toString(), hash: b.hash, timestamp: b.timestamp.toString() });
  return { schema: "raceson-club-observation-v3" as const, chainId: scope.chainId, uploadId: scope.uploadId,
    requestId: scope.requestId, clubId: c.nomination.clubId, slot: c.source.slot, ...expected, candidate,
    initializerHash: observed.initializerHash, deploymentBlock: wire(observed.deploymentBlock), reviewedBlock: wire(observed.safe.finalizedBlock),
    scope: "initialization_only" as const, executionHistoryReviewRequired: true as const };
}
/** Private authorized projection. Reviewed means a saved treasury review,
 * never fresh chain eligibility, collected recipient consent or a paid award. */
export async function getClubReadinessV3(identity: RewardAccountIdentity, input: Omit<ClubReadinessScopeV3,"chainId">, deps: ClubReadinessDependenciesV3) {
  const c = await readClubReadinessV3(actor(identity),{...input,chainId:deps.chainId},deps.rpc);
  return { schema:"raceson-club-readiness-v3" as const, chainId:c.source.chainId, uploadId:c.source.uploadId,
    requestId:c.nomination.requestId,clubId:c.nomination.clubId,slot:c.source.slot,address:c.nomination.candidate.safeAddress,
    state:c.state,sourceCurrent:c.source.current,sourceGuardHash:c.source.sourceGuardHash,identityFingerprint:c.identityFingerprint,
    reviewId:c.review?.id??null,reviewedAt:c.review?.reviewedAt??null,revokedAt:c.review?.revocation?.revokedAt??null };
}
export async function reviewClubReadinessV3(identity: RewardAccountIdentity, input: Omit<ClubReadinessReviewInputV3,"chainId">, deps: ClubReadinessDependenciesV3) {
  const fixed=actor(identity),p=normalizeClubReadinessReviewInputV3({...input,chainId:deps.chainId});
  const {reader,rpc}=deps;
  const c=await readClubReadinessV3(fixed,{...p,role:"operator"},rpc,p.reviewId);
  const e=p.evidence;
  requireReward(e.chainId===p.chainId && JSON.stringify(e.candidate)===JSON.stringify(c.nomination.candidate),"reward_club_review_candidate_mismatch");
  // Exact retries return original history, including revoked/held reviews,
  // without re-observing a newer block or extending an earlier approval.
  if(!c.retryReview){
    requireReward(c.source.current && !["request_withdrawn","identity_hold","source_hold"].includes(c.state),"reward_club_readiness_hold");
    requireReward(c.source.sourceGuardHash===p.sourceGuardHash,"reward_planning_revision_changed");
    requireReward(c.identityFingerprint===p.identityFingerprint,"reward_club_readiness_identity_changed");
    requireReward((c.review?.id??null)===p.previousReviewId,"reward_club_readiness_revision_changed");
    requireReward(reader,"reward_club_reader_required");
    const candidate=c.nomination.candidate;
    const observed=await readVerifiedRewardClubSafeDeployment(typeof reader==="function"?reader():reader,{
      safe:{context:{environment:p.chainId===31337?"local-simulation":"monad-testnet",chainId:p.chainId,verifyingContract:candidate.safeAddress},
        singletonAddress:candidate.singletonAddress,fallbackHandlerAddress:candidate.fallbackHandlerAddress,owners:candidate.owners},
      factoryAddress:e.factoryAddress,deploymentTransactionHash:e.deploymentTransactionHash,
    },{number:BigInt(e.reviewedBlock.number),hash:e.reviewedBlock.hash,timestamp:BigInt(e.reviewedBlock.timestamp)});
    requireReward(observed.initializerHash===e.initializerHash && observed.deploymentBlock.number===BigInt(e.deploymentBlock.number)
      && observed.deploymentBlock.hash===e.deploymentBlock.hash && observed.deploymentBlock.timestamp===BigInt(e.deploymentBlock.timestamp),
    "reward_club_review_chain_evidence_mismatch");
  }
  // Reacquires DB locks after chain IO and checks the original source, actor,
  // owner fingerprint and predecessor. SQL never substitutes newer expectations.
  const r=await recordClubReadinessV3(fixed,p,rpc);
  return {schema:"raceson-club-readiness-record-v3" as const,reviewId:r.id,reviewedAt:r.reviewedAt,revokedAt:r.revocation?.revokedAt??null};
}
export async function revokeClubTreasuryReadinessV3(identity:RewardAccountIdentity,input:Omit<ClubReadinessScopeV3,"chainId"|"role">&{
  reviewId:string;reason:RewardClubReviewRevocationReason},deps:ClubReadinessDependenciesV3){
  const r=await revokeClubReadinessV3(actor(identity),{...input,chainId:deps.chainId},deps.rpc);
  return {schema:"raceson-club-readiness-record-v3" as const,reviewId:r.id,reviewedAt:r.reviewedAt,revokedAt:r.revocation!.revokedAt};
}
