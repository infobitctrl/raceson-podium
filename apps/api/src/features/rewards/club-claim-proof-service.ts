import { requireReward } from "@raceson/domain/rewards";
import { readRewardClubClaimProofs, storeRewardClubClaimProof, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardClubClaimProofContext, type RewardLedgerRpc } from "@raceson/db/rewards";
import { readVerifiedRewardClubClaim, verifyRewardClubSafeConsent, verifyRewardClaimEoaProof, requireLiveRewardClaim,
  safeRewardConsentMessage, readRewardCreationBytecode, type RewardClubClaimReader, type RewardSafeBlock } from "@raceson/rewards-chain";
import { clubRewardClaimExpectation, preparedClubRewardClaim } from "./club-claim-service.js";

type Input = { intentId: string; role: "recipient" | "operator" };
type Deps = { chainId: 31337 | 10143; rpc?: RewardLedgerRpc; reader: RewardClubClaimReader };
function scope(identity: RewardAccountIdentity, input: Input) {
  requireReward(input.role === "recipient" || input.role === "operator", "invalid_reward_claim_proof_role");
  return { identity: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, input: { intentId: uuid(input.intentId), role: input.role } };
}
function exact(context: RewardClubClaimProofContext, chainId: Deps["chainId"]) {
  requireReward(context.claimContext.reviewContext.chainId === chainId, "reward_club_review_chain_mismatch");
  const expected = clubRewardClaimExpectation(context.claimContext), prepared = preparedClubRewardClaim(context.claimContext);
  const { context: campaignContext, ...messages } = prepared;
  return { context, expected, ...messages, campaignContext, safeMessage: safeRewardConsentMessage(campaignContext, prepared.claim) };
}
// Safe consent is stateful. Rechecking a stored historical proof uses its exact
// canonical block, not today's Safe configuration or an EOA recovery shortcut.
async function recipientProof(loaded: ReturnType<typeof exact>, reader: RewardClubClaimReader, signature: `0x${string}`, checkpoint: RewardSafeBlock) {
  const checked = await verifyRewardClubSafeConsent(reader, { safe: loaded.expected.treasury.safe,
    campaignContext: loaded.expected.deployment.context, claim: loaded.claim, signature, checkpoint });
  return { role: checked.role, signer: checked.signer.toLowerCase() as `0x${string}`, digest: checked.digest,
    wrappedDigest: checked.wrappedDigest, signature: checked.signature };
}
/** Private historical proof validation, NOT fresh readiness or a send lease.
 * Fails closed if canonical historical Safe state is unavailable. */
export async function verifyStoredClubRewardClaimProofs(context: RewardClubClaimProofContext, deps: Pick<Deps, "chainId" | "reader">) {
  const loaded = exact(context, deps.chainId);
  for (const saved of context.proofs) {
    const proof = saved.role === "recipient"
      ? await recipientProof(loaded, deps.reader, saved.signature, saved.chainWitness.observation.finalizedBlock)
      : { ...await verifyRewardClaimEoaProof(loaded.expected.deployment.context, loaded.claim, "operator", loaded.expected.deployment.operatorAddress, saved.signature), wrappedDigest: null };
    requireReward(proof.digest === saved.digest && proof.signer === saved.signer && proof.wrappedDigest === saved.wrappedDigest,
      "invalid_reward_club_claim_proof_document");
  }
  return loaded;
}
/** Internal worker/service context; contains signatures and identity evidence. */
export async function loadVerifiedClubRewardClaimProofs(identity: RewardAccountIdentity, input: Input, deps: Deps) {
  const fixed = scope(identity, input), { rpc, chainId, reader } = deps;
  return verifyStoredClubRewardClaimProofs(await readRewardClubClaimProofs(fixed.identity, fixed.input, rpc), { chainId, reader });
}
/** Caller provides its own signature + retry key only. No amount, destination,
 * nonce, witness, actor/session, signing capability or transaction is accepted. */
export async function submitClubRewardClaimProof(identity: RewardAccountIdentity,
  input: Input & { signature: `0x${string}`; idempotencyKey: string }, deps: Deps & { creationCode?: `0x${string}` }) {
  const fixed = scope(identity, input), idempotencyKey = input.idempotencyKey;
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_claim_proof_request");
  requireReward(typeof input.signature === "string" && (fixed.input.role === "operator" ? /^0x[0-9a-fA-F]{130}$/ : /^0x(?:[0-9a-fA-F]{2}){1,8192}$/).test(input.signature),
    "invalid_reward_claim_signature");
  const signature = input.signature.toLowerCase() as `0x${string}`, { rpc, chainId, reader, creationCode } = deps;
  let loaded = await loadVerifiedClubRewardClaimProofs(fixed.identity, fixed.input, { rpc, chainId, reader });
  const existing = loaded.context.proofs.find(p => p.role === fixed.input.role);
  if (existing) {
    requireReward(existing.signature === signature && existing.idempotencyKey === idempotencyKey, "reward_ledger_idempotency_conflict");
  } else {
    const r = loaded.context.claimContext.reviewContext;
    requireReward(r.reviewState === "reviewed" && r.latestReview?.reviewId === loaded.context.intent.treasuryReviewId, "reward_claim_readiness_required");
    requireReward(fixed.input.role !== "operator" || loaded.context.proofs.some(p => p.role === "recipient"), "reward_claim_recipient_consent_required");
    const code = creationCode ?? await readRewardCreationBytecode(reader, loaded.expected.deployment);
    const witness = await readVerifiedRewardClubClaim(reader, loaded.expected, code);
    requireReward(witness.award.nonce === loaded.claim.nonce, "reward_claim_not_live");
    requireLiveRewardClaim(loaded.expected.deployment.context, loaded.claim, witness.observation.finalizedBlock.timestamp, witness.observation.accounting.claimDeadline);
    // Approving an old recipient signature requires that it STILL verifies at
    // this same current award checkpoint (contract-owner state may have changed).
    if (fixed.input.role === "operator") {
      const saved = loaded.context.proofs.find(p => p.role === "recipient")!;
      const checked = await recipientProof(loaded, reader, saved.signature, witness.observation.finalizedBlock);
      requireReward(checked.digest === saved.digest && checked.wrappedDigest === saved.wrappedDigest, "invalid_reward_club_claim_proof_document");
    }
    const proof = fixed.input.role === "recipient"
      ? await recipientProof(loaded, reader, signature, witness.observation.finalizedBlock)
      : { ...await verifyRewardClaimEoaProof(loaded.expected.deployment.context, loaded.claim, "operator", loaded.expected.deployment.operatorAddress, signature), wrappedDigest: null };
    const saved = await storeRewardClubClaimProof(fixed.identity, { ...fixed.input, idempotencyKey, proof, witness, observedAt: new Date().toISOString() }, rpc);
    loaded = await verifyStoredClubRewardClaimProofs(saved, { chainId, reader });
  }
  const saved = loaded.context.proofs.find(p => p.role === fixed.input.role)!;
  return { proofId: saved.proofId, intentId: saved.intentId, role: saved.role, recordedAt: saved.recordedAt, expiresAt: loaded.claim.expiresAt.toString() };
}
