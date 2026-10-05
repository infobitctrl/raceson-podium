import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardClubClaimProofContext } from "./club-claim-proofs.js";
import { decodeRewardClubClaimWitness } from "./club-claims.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_club_payment_document"); }
const same = (a: unknown, b: unknown) => JSON.stringify(copy(a)) === JSON.stringify(copy(b));
function key(v: unknown): string { demand(typeof v === "string" && v.length >= 8 && v.length <= 128); return v; }
function timestamp(v: unknown): string { parseRewardSourceTimestamp(v); return v as string; }
function hash(v: unknown): `0x${string}` { demand(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n); return v as `0x${string}`; }
function address(v: unknown): `0x${string}` { demand(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) > 1n); return v as `0x${string}`; }
function nonce(v: unknown) { const n = integer(v); demand(n <= BigInt(Number.MAX_SAFE_INTEGER)); return n; }
const scope = (identity: RewardAccountIdentity, claimIntentId: string) => ({ identity: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, claimIntentId: uuid(claimIntentId) });
const args = (s: ReturnType<typeof scope>) => ({ p_actor_user_id: s.identity.userId, p_actor_session_id: s.identity.sessionId, p_claim_intent_id: s.claimIntentId });
function decode(value: unknown, s: ReturnType<typeof scope>) {
  const c = object(value, ["claimContext", "paymentIntent"]);
  const claimContext = decodeRewardClubClaimProofContext(c.claimContext, s.identity, { intentId: s.claimIntentId, role: "operator" });
  let paymentIntent = null;
  if (c.paymentIntent !== null) {
    const i = object(c.paymentIntent, ["paymentIntentId", "claimIntentId", "chainId", "relayerAddress", "nonce", "recipientProofId", "operatorProofId",
      "preparedByUserId", "preparedSessionId", "preparedAt", "idempotencyKey", "chainWitness"]);
    const claim = claimContext.intent, u = claimContext.claimContext.lifecycleContext.upload.body, witness = decodeRewardClubClaimWitness(i.chainWitness);
    demand(i.claimIntentId === s.claimIntentId && i.chainId === u.chainId && i.preparedByUserId === s.identity.userId);
    const relayerAddress = address(i.relayerAddress);
    demand(![u.operatorAddress, u.treasuryAddress, claim.recipientAddress, witness.deployment.contractAddress].includes(relayerAddress));
    const recipient = claimContext.proofs.find(p => p.role === "recipient"), operator = claimContext.proofs.find(p => p.role === "operator");
    demand(recipient && operator && i.recipientProofId === recipient.proofId && i.operatorProofId === operator.proofId);
    const original = operator.chainWitness;
    demand(same(witness.deployment, original.deployment) && witness.recipient === claim.recipientAddress && same(witness.award, original.award));
    const { finalizedBlock: ignoredA, ...treasury } = witness.treasury, { finalizedBlock: ignoredB, ...originalTreasury } = original.treasury;
    demand(same(treasury, originalTreasury));
    for (const field of ["budgets", "allocated", "entitlementCount", "uploadDigest", "snapshotDigest", "allocationDigest"] as const)
      demand(same(witness.observation.accounting[field], u[field]));
    demand(witness.observation.accounting.activationNotBefore >= u.sourceReviewEndsAt
      && witness.observation.finalizedBlock.timestamp >= claim.issuedAt && witness.observation.finalizedBlock.timestamp < claim.expiresAt);
    for (const earlier of [claim.chainWitness, recipient.chainWitness, operator.chainWitness]) {
      const a = witness.observation.finalizedBlock, b = earlier.observation.finalizedBlock;
      demand(a.number >= b.number && a.timestamp >= b.timestamp && (a.number !== b.number || same(a, b)));
    }
    paymentIntent = { paymentIntentId: uuid(i.paymentIntentId), claimIntentId: s.claimIntentId, chainId: u.chainId, relayerAddress, nonce: nonce(i.nonce),
      recipientProofId: recipient.proofId, operatorProofId: operator.proofId, preparedByUserId: s.identity.userId, preparedSessionId: uuid(i.preparedSessionId),
      preparedAt: timestamp(i.preparedAt), idempotencyKey: key(i.idempotencyKey), chainWitness: witness };
  }
  return { claimContext, paymentIntent };
}
export type RewardClubPaymentContext = ReturnType<typeof decode>;
export function decodeRewardClubPaymentContext(value: unknown, identity: RewardAccountIdentity, claimIntentId: string) { return decode(value, scope(identity, claimIntentId)); }
const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_claim_proof_scope_required",
  "reward_payment_approvals_required", "reward_payment_intent_required", "reward_payment_already_planned", "reward_payment_nonce_exhausted",
  "reward_payment_attempt_required", "invalid_reward_payment_attempt", "reward_payment_attempt_mismatch", "reward_payment_nonce_consumed",
  "reward_payment_transaction_already_recorded", "reward_ledger_idempotency_conflict",
  "reward_separate_relayer_required", "invalid_reward_payment_request", "reward_claim_readiness_required", "reward_claim_not_live",
  "reward_claim_observation_stale", "reward_claim_observation_regressed", "invalid_reward_claim_witness", "reward_claim_campaign_not_ready",
  "reward_club_review_identity_changed", "reward_club_execution_changed_since_review", "reward_review_source_changed", "reward_review_superseded",
  "reward_mapping_source_not_ready", "reward_record_source_changed", "reward_record_source_not_ready", "reward_record_approval_withdrawn", "reward_record_approval_superseded"]);
async function call(name: Parameters<RewardLedgerRpc>[0], params: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let r: { data: unknown; error: unknown }; try { r = await (rpc ?? ((method, body) => createAdminSupabaseClient().rpc(method, body)))(name, params); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const message = typeof r.error === "object" ? (r.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof message === "string" && safeErrors.has(message) ? message : "reward_ledger_store_failed"); } return r.data;
}
/** Full private capabilities and identity evidence, not a browser projection. */
export async function readRewardClubPaymentContext(identity: RewardAccountIdentity, input: { claimIntentId: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.claimIntentId); return decode(await call("service_read_reward_club_payment_context", args(s), rpc), s);
}
/** Trusted service only, following fresh chain and current Safe-consent checks. */
export async function reserveRewardClubPaymentIntent(identity: RewardAccountIdentity, input: { claimIntentId: string; relayerAddress: `0x${string}`;
  idempotencyKey: string; observedChainId: number; pendingNonce: bigint; witness: unknown; observedAt: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.claimIntentId), relayerAddress = address(input.relayerAddress), idempotencyKey = key(input.idempotencyKey);
  const chain = input.observedChainId; demand(chain === 10143 || chain === 31337); demand(typeof input.pendingNonce === "bigint");
  const pendingNonce = nonce(input.pendingNonce.toString()), witness = copy(input.witness), observedAt = timestamp(input.observedAt); decodeRewardClubClaimWitness(witness);
  const c = decode(await call("service_reserve_reward_club_payment", { ...args(s), p_relayer_address: relayerAddress, p_idempotency_key: idempotencyKey,
    p_observed_chain_id: chain, p_pending_nonce: pendingNonce.toString(), p_witness: witness, p_observed_at: observedAt }, rpc), s);
  demand(c.paymentIntent?.relayerAddress === relayerAddress && c.paymentIntent.idempotencyKey === idempotencyKey && c.paymentIntent.chainId === chain);
  return c;
}

function decodeAttempt(value: unknown) {
  const a = object(value, ["schemaVersion", "action", "chainId", "relayerAddress", "nonce", "contractAddress", "transactionHash", "signedTransaction", "buildId",
    "calldataHash", "entitlementId", "recipient", "amount", "pot", "authorizationNonce", "issuedAt", "expiresAt", "allocationDigest", "operatorDigest", "recipientDigest",
    "value", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "wrappedRecipientDigest", "safeBuildId", "safeExecutionNonce", "consentCheckpoint"]);
  demand(a.schemaVersion === 1 && a.action === "pay_club" && (a.chainId === 10143 || a.chainId === 31337) && (a.pot === "race" || a.pot === "league")
    && typeof a.buildId === "string" && a.buildId.length > 0 && a.buildId.length <= 100 && a.safeBuildId === "safe-1.4.1-original-2-of-3-v1"
    && typeof a.signedTransaction === "string" && a.signedTransaction.length <= 24580 && /^0x02(?:[0-9a-f]{2})+$/.test(a.signedTransaction));
  const amount = integer(a.amount), issuedAt = integer(a.issuedAt), expiresAt = integer(a.expiresAt), valueWei = integer(a.value);
  const gasLimit = integer(a.gasLimit), maxFeePerGas = integer(a.maxFeePerGas), maxPriorityFeePerGas = integer(a.maxPriorityFeePerGas);
  const authorizationNonce = integer(a.authorizationNonce), b = object(a.consentCheckpoint, ["number", "hash", "timestamp"]);
  const consentCheckpoint = { number: integer(b.number), hash: hash(b.hash), timestamp: integer(b.timestamp) };
  demand(amount > 0n && valueWei === 0n && authorizationNonce < (1n << 256n) - 1n && issuedAt > 0n && expiresAt > issuedAt
    && expiresAt - issuedAt <= 86400n && expiresAt < (1n << 64n) && consentCheckpoint.number > 0n
    && consentCheckpoint.timestamp >= issuedAt && consentCheckpoint.timestamp < expiresAt
    && gasLimit > 0n && gasLimit < (1n << 64n) && maxFeePerGas > 0n && maxPriorityFeePerGas <= maxFeePerGas);
  integer((gasLimit * maxFeePerGas).toString());
  return { schemaVersion: 1 as const, action: "pay_club" as const, chainId: a.chainId, relayerAddress: address(a.relayerAddress), nonce: nonce(a.nonce),
    contractAddress: address(a.contractAddress), transactionHash: hash(a.transactionHash), signedTransaction: a.signedTransaction as `0x02${string}`,
    buildId: a.buildId, calldataHash: hash(a.calldataHash), entitlementId: hash(a.entitlementId), recipient: address(a.recipient), amount, pot: a.pot,
    authorizationNonce, issuedAt, expiresAt, allocationDigest: hash(a.allocationDigest), operatorDigest: hash(a.operatorDigest), recipientDigest: hash(a.recipientDigest),
    value: valueWei, gasLimit, maxFeePerGas, maxPriorityFeePerGas, wrappedRecipientDigest: hash(a.wrappedRecipientDigest), safeBuildId: a.safeBuildId,
    safeExecutionNonce: integer(a.safeExecutionNonce), consentCheckpoint };
}

/** Only the private service may store a cryptographically verified attempt.
 * This repository validates shape; it does not sign, verify crypto or send. */
export async function storeRewardClubPaymentAttempt(identity: RewardAccountIdentity, input: { claimIntentId: string; paymentIntentId: string; idempotencyKey: string;
  attempt: unknown; pendingNonce: bigint; witness: unknown; observedAt: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.claimIntentId), paymentIntentId = uuid(input.paymentIntentId), idempotencyKey = key(input.idempotencyKey);
  const body = copy(input.attempt), checked = decodeAttempt(body), witness = copy(input.witness), observedAt = timestamp(input.observedAt);
  decodeRewardClubClaimWitness(witness); demand(typeof input.pendingNonce === "bigint"); const pendingNonce = nonce(input.pendingNonce.toString());
  const r = object(await call("service_record_reward_club_payment_attempt", { ...args(s), p_payment_intent_id: paymentIntentId, p_idempotency_key: idempotencyKey,
    p_attempt: body, p_pending_nonce: pendingNonce.toString(), p_witness: witness, p_observed_at: observedAt }, rpc),
  ["attemptId", "paymentIntentId", "claimIntentId", "recordedByUserId", "recordedAt", "transactionHash"]);
  demand(r.paymentIntentId === paymentIntentId && r.claimIntentId === s.claimIntentId && r.recordedByUserId === s.identity.userId && r.transactionHash === checked.transactionHash);
  return { attemptId: uuid(r.attemptId), paymentIntentId, claimIntentId: s.claimIntentId, recordedByUserId: s.identity.userId,
    recordedAt: timestamp(r.recordedAt), transactionHash: checked.transactionHash };
}

/** Exact private capabilities, never a public projection or current send grant. */
export async function readRewardClubPaymentAttempt(identity: RewardAccountIdentity, input: { claimIntentId: string; paymentIntentId: string; attemptId?: string; idempotencyKey?: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input.claimIntentId), paymentIntentId = uuid(input.paymentIntentId);
  const attemptId = input.attemptId === undefined ? null : uuid(input.attemptId), idempotencyKey = input.idempotencyKey === undefined ? null : key(input.idempotencyKey);
  demand((attemptId === null) !== (idempotencyKey === null));
  const value = await call("service_read_reward_club_payment_attempt", { ...args(s), p_payment_intent_id: paymentIntentId, p_attempt_id: attemptId, p_idempotency_key: idempotencyKey }, rpc);
  if (value === null) { demand(idempotencyKey !== null); return null; }
  const r = object(value, ["context", "attempt"]), c = decode(r.context, s), i = c.paymentIntent; demand(i && i.paymentIntentId === paymentIntentId);
  const a = object(r.attempt, ["attemptId", "paymentIntentId", "body", "recordedByUserId", "recordedSessionId", "recordedAt", "idempotencyKey"]);
  demand(a.paymentIntentId === paymentIntentId && a.recordedByUserId === s.identity.userId && (attemptId === null || a.attemptId === attemptId)
    && (idempotencyKey === null || a.idempotencyKey === idempotencyKey));
  const body = decodeAttempt(a.body), cc = c.claimContext.claimContext, claim = c.claimContext.intent, u = cc.lifecycleContext.upload.body;
  const recipientProof = c.claimContext.proofs.find(p => p.role === "recipient"), operatorProof = c.claimContext.proofs.find(p => p.role === "operator");
  demand(body.chainId === i.chainId && body.relayerAddress === i.relayerAddress && body.nonce === i.nonce && body.recipient === claim.recipientAddress
    && body.entitlementId === cc.entitlement.onChainId && body.amount === cc.entitlement.amountWei && body.authorizationNonce === claim.nonce
    && body.issuedAt === claim.issuedAt && body.expiresAt === claim.expiresAt && body.allocationDigest === u.allocationDigest
    && body.pot === (u.enabledPot === 0 ? "race" : "league") && body.contractAddress === claim.chainWitness.deployment.contractAddress
    && body.buildId === claim.chainWitness.deployment.buildId && body.operatorDigest === operatorProof?.digest && body.recipientDigest === recipientProof?.digest
    && body.wrappedRecipientDigest === recipientProof?.wrappedDigest && body.safeBuildId === claim.chainWitness.treasury.buildId
    && body.safeExecutionNonce === claim.chainWitness.treasury.executionNonce && same(body.consentCheckpoint, recipientProof?.chainWitness.observation.finalizedBlock));
  return { context: c, attempt: { attemptId: uuid(a.attemptId), paymentIntentId, body, recordedByUserId: s.identity.userId,
    recordedSessionId: uuid(a.recordedSessionId), recordedAt: timestamp(a.recordedAt), idempotencyKey: key(a.idempotencyKey) } };
}
