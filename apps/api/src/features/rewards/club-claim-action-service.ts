import { hashTypedData } from "viem";
import { requireReward } from "@raceson/domain/rewards";
import { readRewardClubClaimContext, readRewardClubClaimProofs, readRewardClubSigningContext, rewardDocumentUuid as uuid,
  copyRewardLedgerDocument as copy, type RewardAccountIdentity, type RewardLedgerRpc, type RewardClubClaimProofContext } from "@raceson/db/rewards";
import { readRewardCreationBytecode, readVerifiedRewardClubClaim, requireLiveRewardClaim, verifyRewardClubSafeConsent,
  type RewardClubClaimReader } from "@raceson/rewards-chain";
import { prepareClubRewardClaim, preparedClubRewardClaim } from "./club-claim-service.js";
import { submitClubRewardClaimProof, verifyStoredClubRewardClaimProofs } from "./club-claim-proof-service.js";
import type { RewardPortalConfig } from "./request-identity.js";

type Role = "recipient" | "operator";
type Selection = { intentId: string; role: Role; programmeId?: string };
type Deps = RewardPortalConfig & { rpc?: RewardLedgerRpc; reader: RewardClubClaimReader | (() => RewardClubClaimReader); creationCode?: `0x${string}` };
const actor = (i: RewardAccountIdentity) => ({ userId: uuid(i.userId), sessionId: uuid(i.sessionId) });
function selection(i: Selection) {
  requireReward(i.role === "recipient" || i.role === "operator", "invalid_reward_claim_proof_role");
  requireReward(i.role === "operator" ? i.programmeId !== undefined : i.programmeId === undefined, "invalid_reward_claim_request");
  return { intentId: uuid(i.intentId), role: i.role, programmeId: i.programmeId === undefined ? undefined : uuid(i.programmeId) };
}
function inScope(c: RewardClubClaimProofContext, s: Selection, chainId: Deps["chainId"]) {
  requireReward(c.claimContext.reviewContext.chainId === chainId && (s.programmeId === undefined || c.programmeId === s.programmeId), "reward_claim_proof_scope_required");
  return c;
}
function summary(c: RewardClubClaimProofContext) {
  const p = preparedClubRewardClaim(c.claimContext), i = c.intent;
  return { intentId: i.intentId, programmeId: c.programmeId, campaignId: i.campaignId, entitlementId: i.entitlementId,
    clubId: i.clubId, reviewId: i.treasuryReviewId, chainId: p.context.chainId, verifyingContract: p.context.verifyingContract,
    amountWei: p.claim.amount.toString(), pot: p.claim.pot, recipientAddress: p.claim.recipient,
    issuedAt: p.claim.issuedAt.toString(), expiresAt: p.claim.expiresAt.toString(), role: c.role,
    recipientConsentRecordedAt: c.proofs.find(v => v.role === "recipient")?.recordedAt ?? null,
    operatorApprovalRecordedAt: c.proofs.find(v => v.role === "operator")?.recordedAt ?? null };
}
function unchanged(a: RewardClubClaimProofContext, b: RewardClubClaimProofContext) {
  // An appended proof needs another explicit read/verification, not unverified
  // approval metadata or stale signing controls after this chain observation.
  requireReward(JSON.stringify(copy(a.intent)) === JSON.stringify(copy(b.intent))
    && JSON.stringify(copy(a.proofs)) === JSON.stringify(copy(b.proofs)), "reward_claim_review_changed");
}

/** Scoped operator action. Return a minimal preparation receipt, not signing
 * authority; a separate current review is required before either role signs. */
export async function prepareOrganizerClubClaim(identity: RewardAccountIdentity, input: {
  programmeId: string; reviewId: string; entitlementId: string; idempotencyKey: string;
}, deps: Deps) {
  const who = actor(identity), programmeId = uuid(input.programmeId);
  const request = { reviewId: uuid(input.reviewId), entitlementId: uuid(input.entitlementId), idempotencyKey: input.idempotencyKey };
  const { chainId, rpc } = deps;
  const c = await readRewardClubClaimContext(who, request, rpc);
  requireReward(c.reviewContext.programmeId === programmeId && c.reviewContext.chainId === chainId, "reward_claim_scope_required");
  const p = await prepareClubRewardClaim(who, request, deps);
  return { intentId: p.intentId, programmeId, reviewId: request.reviewId, entitlementId: request.entitlementId,
    clubId: c.entitlement.clubId, campaignId: c.lifecycleContext.deploymentContext.campaignId, chainId: p.context.chainId,
    verifyingContract: p.context.verifyingContract, recipientAddress: p.claim.recipient, amountWei: p.claim.amount.toString(),
    pot: p.claim.pot, issuedAt: p.claim.issuedAt.toString(), expiresAt: p.claim.expiresAt.toString(), state: "prepared" as const };
}

/** Exact role-specific public signing projection. No private proof, wallet key,
 * identity evidence, arbitrary calldata or operator/recipient role override. */
export async function getClubClaimAction(identity: RewardAccountIdentity, input: Selection, deps: Deps) {
  const who = actor(identity), s = selection(input), { rpc, chainId } = deps;
  const read = async () => inScope(await readRewardClubSigningContext(who, s, rpc), s, chainId);
  const initial = await read(), reader = typeof deps.reader === "function" ? deps.reader() : deps.reader;
  const loaded = await verifyStoredClubRewardClaimProofs(initial, { reader, chainId });
  if (initial.proofs.some(p => p.role === s.role)) {
    unchanged(initial, await read());
    return { ...summary(initial), state: "recorded" as const, signing: null, observation: null };
  }
  const code = deps.creationCode ?? await readRewardCreationBytecode(reader, loaded.expected.deployment);
  const witness = await readVerifiedRewardClubClaim(reader, loaded.expected, code), finalized = witness.observation.finalizedBlock;
  requireReward(witness.award.nonce === loaded.claim.nonce, "reward_claim_not_live");
  requireLiveRewardClaim(loaded.campaignContext, loaded.claim, finalized.timestamp, witness.observation.accounting.claimDeadline);
  requireReward(witness.treasury.executionNonce === initial.intent.chainWitness.treasury.executionNonce, "reward_club_execution_changed_since_review");
  if (s.role === "operator") {
    const consent = initial.proofs.find(p => p.role === "recipient"); requireReward(consent, "reward_claim_recipient_consent_required");
    await verifyRewardClubSafeConsent(reader, { safe: loaded.expected.treasury.safe, campaignContext: loaded.campaignContext,
      claim: loaded.claim, signature: consent.signature, checkpoint: finalized });
  }
  const original = initial.intent.chainWitness.observation.finalizedBlock;
  requireReward(finalized.number >= original.number && finalized.timestamp >= original.timestamp
    && (finalized.number !== original.number || (finalized.hash === original.hash && finalized.timestamp === original.timestamp)), "reward_claim_observation_regressed");
  if (chainId === 10143) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    requireReward(finalized.timestamp <= now + 5n && finalized.timestamp >= now - 120n && loaded.claim.expiresAt > now, "reward_claim_observation_stale");
  }
  // The final awaited operation rechecks the actual caller's session, review
  // and sporting source. Never borrow an operator session for club consent.
  unchanged(initial, await read());
  const typed = s.role === "recipient" ? loaded.safeMessage : loaded.messages.authorization;
  const claimMessage = s.role === "recipient" ? loaded.messages.consent : loaded.messages.authorization;
  return { ...summary(initial), state: s.role === "recipient" ? "awaiting_consent" as const : "awaiting_approval" as const,
    signing: { signerAddress: s.role === "recipient" ? loaded.claim.recipient : loaded.expected.deployment.operatorAddress,
      threshold: s.role === "recipient" ? 2 : 1, owners: s.role === "recipient" ? [...loaded.expected.treasury.safe.owners] : [],
      digest: s.role === "recipient" ? hashTypedData(loaded.safeMessage) : hashTypedData(loaded.messages.authorization),
      typedData: copy(typed), claimTypedData: copy(claimMessage) },
    observation: { blockNumber: finalized.number.toString(), blockHash: finalized.hash, timestamp: finalized.timestamp.toString() } };
}

/** Route fixes the role; only an externally produced exact signature is stored.
 * This does not sign, reserve gas, queue a job or broadcast a transaction. */
export async function submitClubClaimAction(identity: RewardAccountIdentity, input: Selection & { signature: `0x${string}`; idempotencyKey: string }, deps: Deps) {
  const who = actor(identity), s = selection(input), signature = input.signature, idempotencyKey = input.idempotencyKey;
  const { rpc, chainId } = deps;
  inScope(await readRewardClubClaimProofs(who, s, rpc), s, chainId);
  const reader = typeof deps.reader === "function" ? deps.reader() : deps.reader;
  const receipt = await submitClubRewardClaimProof(who, { ...s, signature, idempotencyKey }, { ...deps, reader });
  const after = inScope(await readRewardClubClaimProofs(who, s, rpc), s, chainId);
  requireReward(after.proofs.some(p => p.role === s.role && p.proofId === receipt.proofId && p.signature === signature.toLowerCase()), "reward_claim_review_changed");
  return receipt;
}
