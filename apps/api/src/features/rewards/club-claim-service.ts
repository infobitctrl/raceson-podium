import { requireReward } from "@raceson/domain/rewards";
import { readRewardClubClaimContext, storeRewardClubClaimIntent, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardClubClaimContext, type RewardLedgerRpc } from "@raceson/db/rewards";
import { normalizeRewardClubClaimExpectation, readVerifiedRewardClubClaim, readRewardCreationBytecode, rewardClaimMessages, rewardClaimDigests,
  rewardCampaignBuild, type RewardClubClaimReader, type RewardClaim } from "@raceson/rewards-chain";

export function clubRewardClaimExpectation(context: RewardClubClaimContext) {
  const l = context.lifecycleContext, d = l.deploymentContext, c = l.checkpoint, e = context.review.evidence, candidate = e.candidate;
  requireReward(c && d.intent && d.intent.buildId === rewardCampaignBuild.id && d.intent.creationCodeHash === rewardCampaignBuild.creationCodeHash,
    "reward_claim_campaign_not_ready");
  const environment = d.environment === "local_simulation" ? "local-simulation" as const : "monad-testnet" as const;
  const block = (b: typeof e.reviewedBlock) => ({ number: BigInt(b.number), hash: b.hash, timestamp: BigInt(b.timestamp) });
  return normalizeRewardClubClaimExpectation({ deployment: { context: { environment, chainId: d.chainId, verifyingContract: c.deployment.contractAddress },
    operatorAddress: d.operatorAddress, treasuryAddress: d.treasuryAddress, programmeId: d.programmeOnChainId, campaignId: d.campaignOnChainId,
    programmeManifestHash: d.manifestHash, enabledPot: l.upload.body.enabledPot, deploymentTransactionHash: c.deployment.deploymentTransactionHash,
    deploymentNonce: c.deployment.deploymentNonce }, upload: l.upload.body, entitlementId: context.entitlement.onChainId, recipient: candidate.safeAddress,
    treasury: { safe: { context: { environment, chainId: e.chainId, verifyingContract: candidate.safeAddress }, singletonAddress: candidate.singletonAddress,
      fallbackHandlerAddress: candidate.fallbackHandlerAddress, owners: [...candidate.owners] }, factoryAddress: e.factoryAddress, deploymentTransactionHash: e.deploymentTransactionHash },
    review: { reviewedBlock: block(e.reviewedBlock), deploymentBlock: block(e.deploymentBlock), initializerHash: e.initializerHash } });
}
export function preparedClubRewardClaim(context: RewardClubClaimContext) {
  const e = clubRewardClaimExpectation(context), i = context.intent; requireReward(i, "reward_claim_intent_required");
  const claim: RewardClaim = { entitlementId: e.entitlementId, recipient: e.recipient, amount: e.award.amount, pot: e.award.pot === 0 ? "race" : "league",
    nonce: i.nonce, issuedAt: i.issuedAt, expiresAt: i.expiresAt, allocationDigest: e.upload.allocationDigest };
  return { intentId: i.intentId, context: e.deployment.context, claim, messages: rewardClaimMessages(e.deployment.context, claim), digests: rewardClaimDigests(e.deployment.context, claim) };
}
/** Designated-operator-only preparation, not consent, signing, a queue or HTTP.
 * New claims use current chain evidence then locked SQL revalidation. An exact
 * retry returns the original historical messages without refreshing its window. */
export async function prepareClubRewardClaim(identity: RewardAccountIdentity, input: { reviewId: string; entitlementId: string; idempotencyKey: string },
  deps: { chainId: 31337 | 10143; rpc?: RewardLedgerRpc; reader: RewardClubClaimReader | (() => RewardClubClaimReader); creationCode?: `0x${string}` }) {
  const fixed = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) };
  const request = { reviewId: uuid(input.reviewId), entitlementId: uuid(input.entitlementId), idempotencyKey: input.idempotencyKey };
  requireReward(typeof request.idempotencyKey === "string" && request.idempotencyKey.length >= 8 && request.idempotencyKey.length <= 128, "invalid_reward_claim_request");
  const { rpc, reader, creationCode, chainId } = deps;
  let context = await readRewardClubClaimContext(fixed, request, rpc);
  requireReward(context.reviewContext.chainId === chainId, "reward_club_review_chain_mismatch");
  if (context.intent) return preparedClubRewardClaim(context);
  requireReward(context.reviewContext.reviewState === "reviewed" && context.reviewContext.latestReview?.reviewId === request.reviewId, "reward_claim_readiness_required");
  const expected = clubRewardClaimExpectation(context);
  const chain = typeof reader === "function" ? reader() : reader;
  const code = creationCode ?? await readRewardCreationBytecode(chain, expected.deployment);
  const witness = await readVerifiedRewardClubClaim(chain, expected, code);
  context = await storeRewardClubClaimIntent(fixed, { ...request, witness, observedAt: new Date().toISOString() }, rpc);
  return preparedClubRewardClaim(context);
}
