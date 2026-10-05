import { requireReward } from "@raceson/domain/rewards";
import { readRewardClubPaymentContext, reserveRewardClubPaymentIntent, readRewardClubPaymentAttempt, storeRewardClubPaymentAttempt, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardClubPaymentContext, type RewardLedgerRpc } from "@raceson/db/rewards";
import { readVerifiedRewardClubClaim, verifyRewardClubSafeConsent, requireLiveRewardClaim, readRewardPendingNonce, encodeRewardClubPayment,
  canonicalRewardJson, normalizeRewardClubPaymentPlan, verifySignedRewardClubPayment,
  RewardProtocolError, type RewardClubClaimReader, type RewardNonceReader } from "@raceson/rewards-chain";
import { verifyStoredClubRewardClaimProofs } from "./club-claim-proof-service.js";

type Config = { chainId: 31337 | 10143; rpc?: RewardLedgerRpc; reader: RewardClubClaimReader };
type LiveDeps = Config & { reader: RewardClubClaimReader & RewardNonceReader; creationCode: `0x${string}` };
const scope = (i: RewardAccountIdentity, claimIntentId: string) => ({ identity: { userId: uuid(i.userId), sessionId: uuid(i.sessionId) }, claimIntentId: uuid(claimIntentId) });
async function approved(context: RewardClubPaymentContext, deps: Config) {
  const loaded = await verifyStoredClubRewardClaimProofs(context.claimContext, deps);
  const operator = loaded.context.proofs.find(p => p.role === "operator"), recipient = loaded.context.proofs.find(p => p.role === "recipient");
  requireReward(operator && recipient, "reward_payment_approvals_required");
  return { ...loaded, proofs: { operator: operator.signature, recipient: recipient.signature }, recipientProof: recipient };
}
type Approved = Awaited<ReturnType<typeof approved>>;
function separate(a: Approved, relayer: `0x${string}`) {
  requireReward(![a.expected.deployment.operatorAddress, a.expected.deployment.treasuryAddress, a.expected.recipient,
    a.expected.deployment.context.verifyingContract].some(x => x.toLowerCase() === relayer), "reward_separate_relayer_required");
}
function prepared(context: RewardClubPaymentContext, a: Approved) {
  const i = context.paymentIntent; requireReward(i, "reward_payment_intent_required"); separate(a, i.relayerAddress);
  const p = { claimIntentId: i.claimIntentId, paymentIntentId: i.paymentIntentId, relayerAddress: i.relayerAddress, nonce: i.nonce,
    expected: a.expected, claim: a.claim, proofs: a.proofs, consentCheckpoint: a.recipientProof.chainWitness.observation.finalizedBlock,
  };
  return { ...p, transaction: encodeRewardClubPayment(p) };
}
/** Exact historical preparation reload, not a fresh send lease. Contains
 * signature capabilities; never expose this plan as an HTTP/browser response. */
export async function loadVerifiedClubRewardPayment(identity: RewardAccountIdentity, input: { claimIntentId: string; paymentIntentId: string }, deps: Config) {
  const s = scope(identity, input.claimIntentId), paymentIntentId = uuid(input.paymentIntentId), { rpc, chainId, reader } = deps;
  const context = await readRewardClubPaymentContext(s.identity, { claimIntentId: s.claimIntentId }, rpc);
  requireReward(context.paymentIntent?.paymentIntentId === paymentIntentId, "reward_payment_intent_required");
  return prepared(context, await approved(context, { chainId, reader }));
}
/** Current club proof/award and gas-payer observation. No chain write and no
 * network request inside a SQL transaction. SQL repeats private state checks. */
async function fresh(a: Approved, relayer: `0x${string}`, deps: LiveDeps) {
  const r = a.context.claimContext.reviewContext;
  requireReward(r.reviewState === "reviewed" && r.latestReview?.reviewId === a.context.intent.treasuryReviewId, "reward_claim_readiness_required");
  separate(a, relayer);
  const witness = await readVerifiedRewardClubClaim(deps.reader, a.expected, deps.creationCode);
  requireReward(witness.award.nonce === a.claim.nonce, "reward_claim_not_live");
  const block = witness.observation.finalizedBlock;
  requireLiveRewardClaim(a.expected.deployment.context, a.claim, block.timestamp, witness.observation.accounting.claimDeadline);
  const consent = await verifyRewardClubSafeConsent(deps.reader, { safe: a.expected.treasury.safe, campaignContext: a.expected.deployment.context,
    claim: a.claim, signature: a.proofs.recipient, checkpoint: block });
  requireReward(consent.digest === a.recipientProof.digest && consent.wrappedDigest === a.recipientProof.wrappedDigest, "invalid_reward_club_claim_proof_document");
  let code, again;
  try { code = await deps.reader.getCode({ address: relayer, blockNumber: block.number }); again = await deps.reader.getBlock({ blockNumber: block.number }); }
  catch { throw new RewardProtocolError("reward_payment_observation_unavailable"); }
  requireReward(code === undefined || code === "0x", "reward_relayer_eoa_required");
  requireReward(again.number === block.number && again.hash?.toLowerCase() === block.hash && again.timestamp === block.timestamp, "reward_chain_changed_during_observation");
  return { witness, pendingNonce: await readRewardPendingNonce(deps.reader, a.expected.deployment.context, relayer) };
}
/** Reserve one typed slot in the SAME relayer book as athlete payments. The
 * caller cannot supply the nonce, amount, recipient, proofs or raw transaction. */
export async function prepareClubRewardPayment(identity: RewardAccountIdentity,
  input: { claimIntentId: string; idempotencyKey: string; relayerAddress: `0x${string}` }, dependencies: LiveDeps) {
  const s = scope(identity, input.claimIntentId), idempotencyKey = input.idempotencyKey;
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_payment_request");
  requireReward(typeof input.relayerAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(input.relayerAddress) && BigInt(input.relayerAddress) > 1n, "invalid_reward_payment_request");
  const relayerAddress = input.relayerAddress.toLowerCase() as `0x${string}`, { rpc, chainId, reader, creationCode } = dependencies;
  const deps = { rpc, chainId, reader, creationCode };
  let context = await readRewardClubPaymentContext(s.identity, { claimIntentId: s.claimIntentId }, rpc), a = await approved(context, deps);
  if (context.paymentIntent) requireReward(context.paymentIntent.idempotencyKey === idempotencyKey && context.paymentIntent.relayerAddress === relayerAddress, "reward_payment_already_planned");
  else {
    const observation = await fresh(a, relayerAddress, deps);
    context = await reserveRewardClubPaymentIntent(s.identity, { claimIntentId: s.claimIntentId, relayerAddress, idempotencyKey, observedChainId: chainId,
      pendingNonce: observation.pendingNonce, witness: observation.witness, observedAt: new Date().toISOString() }, rpc);
    a = await approved(context, deps);
  }
  return prepared(context, a);
}

/** Reload and reverify the entire signed attempt, including original Safe
 * consent/provenance. The result contains capabilities, never browser data. */
export async function loadVerifiedClubRewardPaymentAttempt(identity: RewardAccountIdentity,
  input: { claimIntentId: string; paymentIntentId: string; attemptId: string }, dependencies: Config) {
  const s = scope(identity, input.claimIntentId), paymentIntentId = uuid(input.paymentIntentId), attemptId = uuid(input.attemptId);
  const { rpc, chainId, reader } = dependencies;
  const loaded = await readRewardClubPaymentAttempt(s.identity, { claimIntentId: s.claimIntentId, paymentIntentId, attemptId }, rpc);
  requireReward(loaded, "reward_payment_attempt_required");
  const a = await approved(loaded.context, { chainId, reader }), plan = normalizeRewardClubPaymentPlan(prepared(loaded.context, a));
  const verified = await verifySignedRewardClubPayment(reader, plan, loaded.attempt.body.signedTransaction);
  requireReward(canonicalRewardJson(verified) === canonicalRewardJson(loaded.attempt.body), "reward_stored_payment_attempt_mismatch");
  return { claimIntentId: s.claimIntentId, paymentIntentId, attemptId, plan, verified };
}

/** Future queue/arm callers need this current observation as well as a SQL
 * transition that repeats identity/source/session checks. This is NOT a lease. */
export async function observeFreshClubRewardPayment(identity: RewardAccountIdentity,
  input: { claimIntentId: string; paymentIntentId: string; attemptId: string }, dependencies: LiveDeps) {
  const s = scope(identity, input.claimIntentId), paymentIntentId = uuid(input.paymentIntentId), attemptId = uuid(input.attemptId);
  const { rpc, chainId, reader, creationCode } = dependencies, deps = { rpc, chainId, reader, creationCode };
  const loaded = await loadVerifiedClubRewardPaymentAttempt(s.identity, { claimIntentId: s.claimIntentId, paymentIntentId, attemptId }, deps);
  const context = await readRewardClubPaymentContext(s.identity, { claimIntentId: s.claimIntentId }, rpc), a = await approved(context, deps);
  requireReward(canonicalRewardJson(normalizeRewardClubPaymentPlan(prepared(context, a))) === canonicalRewardJson(loaded.plan), "reward_stored_payment_attempt_mismatch");
  return { ...loaded, ...await fresh(a, loaded.plan.relayerAddress.toLowerCase() as `0x${string}`, deps) };
}

/** Accept only the exact reserved claim signed by its independent gas payer.
 * Exact retries preserve history. Every new fee variant needs fresh eligibility
 * and an unconsumed nonce; saving it never sends or automatically replaces it. */
export async function recordSignedClubRewardPayment(identity: RewardAccountIdentity,
  input: { claimIntentId: string; paymentIntentId: string; idempotencyKey: string; signedTransaction: `0x${string}` }, dependencies: LiveDeps) {
  const s = scope(identity, input.claimIntentId), paymentIntentId = uuid(input.paymentIntentId), idempotencyKey = input.idempotencyKey;
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_payment_request");
  const signedTransaction = input.signedTransaction, { rpc, chainId, reader, creationCode } = dependencies, deps = { rpc, chainId, reader, creationCode };
  const context = await readRewardClubPaymentContext(s.identity, { claimIntentId: s.claimIntentId }, rpc);
  requireReward(context.paymentIntent?.paymentIntentId === paymentIntentId, "reward_payment_intent_required");
  const a = await approved(context, deps), verified = await verifySignedRewardClubPayment(reader, prepared(context, a), signedTransaction);
  const existing = await readRewardClubPaymentAttempt(s.identity, { claimIntentId: s.claimIntentId, paymentIntentId, idempotencyKey }, rpc);
  if (existing) {
    requireReward(canonicalRewardJson(verified) === canonicalRewardJson(existing.attempt.body), "reward_ledger_idempotency_conflict");
    return { attemptId: existing.attempt.attemptId, paymentIntentId, claimIntentId: s.claimIntentId, recordedByUserId: s.identity.userId,
      recordedAt: existing.attempt.recordedAt, transactionHash: verified.transactionHash };
  }
  const observed = await fresh(a, context.paymentIntent.relayerAddress, deps);
  requireReward(observed.pendingNonce <= context.paymentIntent.nonce, "reward_payment_nonce_consumed");
  return storeRewardClubPaymentAttempt(s.identity, { claimIntentId: s.claimIntentId, paymentIntentId, idempotencyKey, attempt: verified,
    pendingNonce: observed.pendingNonce, witness: observed.witness, observedAt: new Date().toISOString() }, rpc);
}
