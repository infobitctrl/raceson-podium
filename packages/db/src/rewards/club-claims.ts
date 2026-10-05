import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardClubReviewContext, decodeRewardClubTreasuryReview } from "./club-treasury-reviews.js";
import { decodeRewardClubTreasuryCandidate } from "./club-treasuries.js";
import { decodeRewardLifecycleContext } from "./lifecycle-intents.js";
import { decodeRewardCampaignDeployment, decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_club_claim_document"); }
function key(v: unknown): string { demand(typeof v === "string" && v.length >= 8 && v.length <= 128); return v; }
function hash(v: unknown): `0x${string}` { demand(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n); return v as `0x${string}`; }
function address(v: unknown): `0x${string}` { demand(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) > 1n); return v as `0x${string}`; }
function timestamp(v: unknown): string { parseRewardSourceTimestamp(v); return v as string; }
const same = (a: unknown, b: unknown) => JSON.stringify(copy(a)) === JSON.stringify(copy(b));
function block(v: unknown) { const b = object(v, ["number", "hash", "timestamp"]); return { number: integer(b.number), hash: hash(b.hash), timestamp: integer(b.timestamp) }; }
function precedes(a: ReturnType<typeof block>, b: ReturnType<typeof block>) { return a.number <= b.number && a.timestamp <= b.timestamp && (a.number !== b.number || same(a, b)); }
type Input = { reviewId: string; entitlementId: string; idempotencyKey?: string };
function scope(i: RewardAccountIdentity, r: Input) { return { userId: uuid(i.userId), sessionId: uuid(i.sessionId), reviewId: uuid(r.reviewId),
  entitlementId: uuid(r.entitlementId), idempotencyKey: r.idempotencyKey === undefined ? null : key(r.idempotencyKey) }; }

/** Structural historical evidence only. Exact code/history reads belong to the
 * chain service; this decoder cannot establish a current treasury approval. */
export function decodeRewardClubClaimWitness(value: unknown) {
  const w = object(value, ["deployment", "observation", "award", "recipient", "treasury"]);
  const deployment = decodeRewardCampaignDeployment(w.deployment), observation = decodeRewardCampaignObservation(w.observation);
  const a = object(w.award, ["entitlementId", "beneficiaryId", "pot", "amount", "explanationHash", "beneficiaryKind", "nonce", "paid"]);
  demand((a.pot === 0 || a.pot === 1) && a.beneficiaryKind === 1 && a.paid === false);
  const amount = integer(a.amount), nonce = integer(a.nonce), recipient = address(w.recipient), pot = a.pot as 0 | 1;
  demand(amount > 0n && nonce < (1n << 256n) - 1n);
  const t = object(w.treasury, ["schemaVersion", "buildId", "provenanceId", "scope", "executionHistoryReviewRequired", "safeAddress",
    "singletonAddress", "fallbackHandlerAddress", "owners", "factoryAddress", "deploymentTransactionHash", "initializerHash", "deploymentBlock", "reviewedBlock", "finalizedBlock", "executionNonce"]);
  const candidate = decodeRewardClubTreasuryCandidate({ safeAddress: t.safeAddress, singletonAddress: t.singletonAddress,
    fallbackHandlerAddress: t.fallbackHandlerAddress, owners: t.owners });
  demand(t.schemaVersion === 1 && t.buildId === "safe-1.4.1-original-2-of-3-v1" && t.provenanceId === "safe-1.4.1-original-direct-initialization-v1"
    && t.scope === "initialization_only" && t.executionHistoryReviewRequired === true && recipient === candidate.safeAddress);
  const factoryAddress = address(t.factoryAddress), deploymentBlock = block(t.deploymentBlock), reviewedBlock = block(t.reviewedBlock), finalizedBlock = block(t.finalizedBlock);
  demand(![candidate.safeAddress, candidate.singletonAddress, candidate.fallbackHandlerAddress].includes(factoryAddress)
    && deployment.contractAddress !== recipient && deploymentBlock.number > 0n && precedes(deploymentBlock, reviewedBlock)
    && precedes(reviewedBlock, finalizedBlock) && same(finalizedBlock, observation.finalizedBlock));
  const c = observation.accounting, now = observation.finalizedBlock.timestamp;
  demand(c.state === 3 && !c.paused && c.pausedAt === 0n && c.treasuryReturned === 0n && now > 0n && now < (1n << 64n) - 86400n
    && now < c.claimDeadline && now >= c.activationNotBefore && c.budgets[pot] === c.accountedFunding
    && c.budgets[1 - pot] === 0n && c.allocated[1 - pot] === 0n && c.paid[1 - pot] === 0n
    && c.paid[pot] <= c.allocated[pot] && c.allocated[pot] <= c.budgets[pot]
    && c.nativeBalance >= c.accountedFunding - c.paid[pot] && amount <= c.allocated[pot]);
  return { deployment, observation, award: { entitlementId: hash(a.entitlementId), beneficiaryId: hash(a.beneficiaryId), pot, amount,
    explanationHash: hash(a.explanationHash), beneficiaryKind: 1 as const, nonce, paid: false as const }, recipient,
    treasury: { schemaVersion: 1 as const, buildId: t.buildId, provenanceId: t.provenanceId, scope: "initialization_only" as const,
      executionHistoryReviewRequired: true as const, ...candidate, factoryAddress, deploymentTransactionHash: hash(t.deploymentTransactionHash),
      initializerHash: hash(t.initializerHash), deploymentBlock, reviewedBlock, finalizedBlock, executionNonce: integer(t.executionNonce) } };
}
export function decodeRewardClubClaimIntent(value: unknown) {
  const i = object(value, ["intentId", "campaignId", "entitlementId", "treasuryReviewId", "uploadId", "clubId", "recipientUserId", "recipientAddress",
    "nonce", "issuedAt", "expiresAt", "preparedByUserId", "preparedSessionId", "preparedAt", "idempotencyKey", "chainWitness"]);
  const chainWitness = decodeRewardClubClaimWitness(i.chainWitness), nonce = integer(i.nonce), issuedAt = integer(i.issuedAt), expiresAt = integer(i.expiresAt);
  const recipientAddress = address(i.recipientAddress), deadline = chainWitness.observation.accounting.claimDeadline;
  demand(chainWitness.recipient === recipientAddress && chainWitness.award.nonce === nonce && issuedAt === chainWitness.observation.finalizedBlock.timestamp
    && expiresAt > issuedAt && expiresAt < 1n << 64n && expiresAt === (issuedAt + 86400n < deadline ? issuedAt + 86400n : deadline));
  return { intentId: uuid(i.intentId), campaignId: uuid(i.campaignId), entitlementId: uuid(i.entitlementId), treasuryReviewId: uuid(i.treasuryReviewId),
    uploadId: uuid(i.uploadId), clubId: uuid(i.clubId), recipientUserId: uuid(i.recipientUserId), recipientAddress, nonce, issuedAt, expiresAt,
    preparedByUserId: uuid(i.preparedByUserId), preparedSessionId: uuid(i.preparedSessionId), preparedAt: timestamp(i.preparedAt), idempotencyKey: key(i.idempotencyKey), chainWitness };
}
function decode(value: unknown, s: Omit<ReturnType<typeof scope>, "sessionId">) {
  const r = object(value, ["reviewContext", "review", "lifecycleContext", "entitlement", "intent"]);
  const raw = r.reviewContext as Record<string, unknown>; demand(raw && typeof raw === "object");
  const nomination = raw.nomination as Record<string, unknown>; demand(nomination && typeof nomination === "object");
  const reviewContext = decodeRewardClubReviewContext(raw, s, uuid(raw.programmeId), uuid(nomination.requestId));
  const review = decodeRewardClubTreasuryReview(r.review, reviewContext.programmeId, s.userId);
  demand(review.reviewId === s.reviewId && review.requestId === reviewContext.nomination.requestId && review.evidence.chainId === reviewContext.chainId
    && same(review.evidence.candidate, reviewContext.nomination.candidate));
  const lc = r.lifecycleContext as Record<string, unknown>; demand(lc && typeof lc === "object");
  const d = lc.deploymentContext as Record<string, unknown>, u = lc.upload as Record<string, unknown>; demand(d && u);
  const lifecycleContext = decodeRewardLifecycleContext(lc, { campaignId: uuid(d.campaignId), actorUserId: s.userId, uploadId: uuid(u.id), intentId: null, idempotencyKey: null });
  demand(lifecycleContext.deploymentContext.programmeId === reviewContext.programmeId && lifecycleContext.deploymentContext.chainId === reviewContext.chainId);
  const e = object(r.entitlement, ["id", "onChainId", "beneficiaryId", "clubId", "amountWei"]);
  demand(e.id === s.entitlementId && e.clubId === reviewContext.nomination.clubId);
  const entitlement = { id: s.entitlementId, onChainId: hash(e.onChainId), beneficiaryId: hash(e.beneficiaryId), clubId: uuid(e.clubId), amountWei: integer(e.amountWei) };
  const upload = lifecycleContext.upload.body, award = upload.awards.find(a => a.entitlementId === entitlement.onChainId);
  demand(award && award.beneficiaryKind === 1 && award.amount === entitlement.amountWei && award.beneficiaryId === entitlement.beneficiaryId);
  const intent = r.intent === null ? null : decodeRewardClubClaimIntent(r.intent);
  if (intent) {
    const w = intent.chainWitness, t = w.treasury, evidence = review.evidence;
    const { nonce: ignoredNonce, paid: ignoredPaid, ...earned } = w.award;
    demand(intent.campaignId === d.campaignId && intent.entitlementId === s.entitlementId && intent.treasuryReviewId === s.reviewId
      && intent.uploadId === u.id && intent.clubId === entitlement.clubId && intent.recipientUserId === reviewContext.nomination.userId
      && intent.recipientAddress === evidence.candidate.safeAddress && intent.preparedByUserId === s.userId
      && (s.idempotencyKey === null || intent.idempotencyKey === s.idempotencyKey) && lifecycleContext.checkpoint
      && same(w.deployment, lifecycleContext.checkpoint.deployment) && same(earned, award));
    for (const field of ["budgets", "allocated", "entitlementCount", "uploadDigest", "snapshotDigest", "allocationDigest"] as const)
      demand(same(w.observation.accounting[field], upload[field]));
    demand(w.observation.accounting.activationNotBefore >= upload.sourceReviewEndsAt);
    for (const field of ["safeAddress", "singletonAddress", "fallbackHandlerAddress", "owners"] as const) demand(same(t[field], evidence.candidate[field]));
    for (const field of ["factoryAddress", "deploymentTransactionHash", "initializerHash", "deploymentBlock", "reviewedBlock"] as const) demand(same(t[field], evidence[field]));
  }
  return { reviewContext, review, lifecycleContext, entitlement, intent };
}
export type RewardClubClaimContext = ReturnType<typeof decode>;
// Composite subject decoding only; this does not authorize or impersonate the
// operator. The enclosing RPC checks the actual caller's identity/session.
export { decode as decodeRewardClubClaimContext };
const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_claim_scope_required", "reward_claim_identity_mapping_required",
  "reward_claim_campaign_not_ready", "invalid_reward_claim_request", "invalid_reward_claim_witness", "reward_claim_observation_regressed", "reward_claim_observation_stale",
  "reward_claim_nonce_exhausted", "reward_claim_already_prepared", "reward_claim_readiness_required", "reward_ledger_idempotency_conflict", "reward_club_review_identity_changed",
  "reward_review_superseded", "reward_review_source_changed", "reward_mapping_source_not_ready", "reward_record_approval_withdrawn", "reward_record_approval_superseded", "reward_record_source_changed", "reward_record_source_not_ready"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let r: { data: unknown; error: unknown }; try { r = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (r.error) { const code = typeof r.error === "object" ? (r.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safeErrors.has(code) ? code : "reward_ledger_store_failed"); } return r.data;
}
const args = (s: ReturnType<typeof scope>) => ({ p_actor_user_id: s.userId, p_actor_session_id: s.sessionId, p_review_id: s.reviewId, p_entitlement_id: s.entitlementId, p_idempotency_key: s.idempotencyKey });
export async function readRewardClubClaimContext(identity: RewardAccountIdentity, input: Input, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input); return decode(await call("service_read_reward_club_claim_context", args(s), rpc), s);
}
/** Trusted service only, after the composed chain observation; never browser JSON. */
export async function storeRewardClubClaimIntent(identity: RewardAccountIdentity, input: Input & { idempotencyKey: string; witness: unknown; observedAt: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input), witness = copy(input.witness), observedAt = timestamp(input.observedAt); decodeRewardClubClaimWitness(witness);
  const result = decode(await call("service_prepare_reward_club_claim", { ...args(s), p_witness: witness, p_observed_at: observedAt }, rpc), s);
  demand(result.intent !== null); return result;
}
