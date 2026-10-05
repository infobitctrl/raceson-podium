import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentArray as array, rewardDocumentUuid as uuid } from "./stored-documents.js";
import { decodeRewardClubClaimContext, decodeRewardClubClaimIntent, decodeRewardClubClaimWitness } from "./club-claims.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_club_claim_proof_document"); }
function role(v: unknown): "recipient" | "operator" { demand(v === "recipient" || v === "operator"); return v; }
function key(v: unknown): string { demand(typeof v === "string" && v.length >= 8 && v.length <= 128); return v; }
function hash(v: unknown): `0x${string}` { demand(typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v) > 0n); return v as `0x${string}`; }
function address(v: unknown): `0x${string}` { demand(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) > 1n); return v as `0x${string}`; }
function stamp(v: unknown): string { parseRewardSourceTimestamp(v); return v as string; }
const same = (a: unknown, b: unknown) => JSON.stringify(copy(a)) === JSON.stringify(copy(b));
type Input = { intentId: string; role: "recipient" | "operator" };
const scope = (i: RewardAccountIdentity, r: Input) => ({ userId: uuid(i.userId), sessionId: uuid(i.sessionId), intentId: uuid(r.intentId), role: role(r.role) });

/** Shape only: Safe consent is stateful and MUST be verified through ERC-1271. */
export function decodeRewardClubClaimProof(value: unknown) {
  const p = object(value, ["role", "signer", "digest", "wrappedDigest", "signature"]), kind = role(p.role);
  demand(typeof p.signature === "string" && (kind === "operator" ? /^0x[0-9a-f]{130}$/ : /^0x(?:[0-9a-f]{2}){1,8192}$/).test(p.signature));
  demand(kind !== "operator" || p.wrappedDigest === null);
  return { role: kind, signer: address(p.signer), digest: hash(p.digest), wrappedDigest: kind === "recipient" ? hash(p.wrappedDigest) : null,
    signature: p.signature as `0x${string}` };
}
function savedProof(value: unknown) {
  const p = object(value, ["proofId", "intentId", "role", "signer", "digest", "wrappedDigest", "signature", "recordedByUserId", "recordedSessionId", "recordedAt", "idempotencyKey", "chainWitness"]);
  return { ...decodeRewardClubClaimProof({ role: p.role, signer: p.signer, digest: p.digest, wrappedDigest: p.wrappedDigest, signature: p.signature }),
    proofId: uuid(p.proofId), intentId: uuid(p.intentId), recordedByUserId: uuid(p.recordedByUserId), recordedSessionId: uuid(p.recordedSessionId),
    recordedAt: stamp(p.recordedAt), idempotencyKey: key(p.idempotencyKey), chainWitness: decodeRewardClubClaimWitness(p.chainWitness) };
}
function decode(value: unknown, s: ReturnType<typeof scope>) {
  const c = object(value, ["actorUserId", "role", "programmeId", "operatorUserId", "claimContext", "proofs"]);
  demand(c.actorUserId === s.userId && c.role === s.role);
  const programmeId = uuid(c.programmeId), operatorUserId = uuid(c.operatorUserId);
  const raw = object(c.claimContext, ["reviewContext", "review", "lifecycleContext", "entitlement", "intent"]);
  const intent = decodeRewardClubClaimIntent(raw.intent);
  demand(intent.intentId === s.intentId && intent.preparedByUserId === operatorUserId
    && s.userId === (s.role === "operator" ? operatorUserId : intent.recipientUserId));
  const claimContext = decodeRewardClubClaimContext(raw, { userId: operatorUserId, reviewId: intent.treasuryReviewId,
    entitlementId: intent.entitlementId, idempotencyKey: intent.idempotencyKey });
  demand(claimContext.reviewContext.programmeId === programmeId);
  const proofs = array(c.proofs, 2, savedProof), roles = new Set<string>();
  const original = intent.chainWitness;
  const monotonic = (a: typeof original.observation.finalizedBlock, b: typeof a) => demand(a.number <= b.number
    && a.timestamp <= b.timestamp && (a.number !== b.number || same(a, b)));
  for (const p of proofs) {
    demand(!roles.has(p.role) && p.intentId === intent.intentId && p.recordedByUserId === (p.role === "operator" ? operatorUserId : intent.recipientUserId)
      && p.signer === (p.role === "operator" ? claimContext.lifecycleContext.upload.body.operatorAddress : intent.recipientAddress));
    roles.add(p.role);
    const w = p.chainWitness, at = w.observation.finalizedBlock;
    demand(same(w.deployment, original.deployment) && same(w.award, original.award) && w.recipient === original.recipient
      && at.timestamp >= intent.issuedAt && at.timestamp < intent.expiresAt);
    const { finalizedBlock: ignoredA, ...treasury } = w.treasury;
    const { finalizedBlock: ignoredB, ...originalTreasury } = original.treasury;
    demand(same(treasury, originalTreasury));
    for (const field of ["budgets", "allocated", "entitlementCount", "uploadDigest", "snapshotDigest", "allocationDigest", "activationNotBefore"] as const)
      demand(same(w.observation.accounting[field], original.observation.accounting[field]));
    monotonic(original.observation.finalizedBlock, at);
  }
  demand(!roles.has("operator") || roles.has("recipient"));
  if (proofs.length === 2) monotonic(proofs.find(p => p.role === "recipient")!.chainWitness.observation.finalizedBlock,
    proofs.find(p => p.role === "operator")!.chainWitness.observation.finalizedBlock);
  return { actorUserId: s.userId, role: s.role, programmeId, operatorUserId, intent, claimContext, proofs };
}
export type RewardClubClaimProofContext = ReturnType<typeof decode>;
export function decodeRewardClubClaimProofContext(value: unknown, identity: RewardAccountIdentity, input: Input) { return decode(value, scope(identity, input)); }
const safeErrors = new Set(["reward_account_session_required", "reward_operator_permission_required", "reward_claim_proof_scope_required",
  "reward_claim_readiness_required", "reward_claim_recipient_consent_required", "reward_claim_not_live", "reward_claim_observation_stale",
  "reward_claim_observation_regressed", "invalid_reward_claim_proof", "invalid_reward_claim_witness", "reward_ledger_idempotency_conflict",
  "reward_club_review_identity_changed", "reward_club_execution_changed_since_review", "reward_claim_campaign_not_ready",
  "reward_review_superseded", "reward_review_source_changed", "reward_mapping_source_not_ready", "reward_record_approval_withdrawn",
  "reward_record_approval_superseded", "reward_record_source_changed", "reward_record_source_not_ready"]);
async function call(name: Parameters<RewardLedgerRpc>[0], args: Record<string, unknown>, rpc?: RewardLedgerRpc) {
  let result: { data: unknown; error: unknown };
  try { result = await (rpc ?? ((method, params) => createAdminSupabaseClient().rpc(method, params)))(name, args); }
  catch { throw new RewardLedgerStoreError("reward_ledger_unavailable"); }
  if (result.error) { const code = typeof result.error === "object" ? (result.error as Record<string, unknown>).message : null;
    throw new RewardLedgerStoreError(typeof code === "string" && safeErrors.has(code) ? code : "reward_ledger_store_failed"); }
  return result.data;
}
const args = (s: ReturnType<typeof scope>) => ({ p_actor_user_id: s.userId, p_actor_session_id: s.sessionId, p_intent_id: s.intentId, p_role: s.role });
/** Private capabilities and identity evidence. Never a browser response. */
export async function readRewardClubClaimProofs(identity: RewardAccountIdentity, input: Input, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input); return decode(await call("service_read_reward_club_claim_proofs", args(s), rpc), s);
}
/** Current source/readiness checks for offering a NEW signature; historical
 * recorded proofs remain readable. This private context is never an HTTP body. */
export async function readRewardClubSigningContext(identity: RewardAccountIdentity, input: Input, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input); return decode(await call("service_read_reward_club_signing_context", args(s), rpc), s);
}
/** Internal storage after the service has verified exact signatures and chain. */
export async function storeRewardClubClaimProof(identity: RewardAccountIdentity,
  input: Input & { idempotencyKey: string; proof: unknown; witness: unknown; observedAt: string }, rpc?: RewardLedgerRpc) {
  const s = scope(identity, input), idempotencyKey = key(input.idempotencyKey), proof = decodeRewardClubClaimProof(input.proof);
  demand(proof.role === s.role); const witness = copy(input.witness); decodeRewardClubClaimWitness(witness); const observedAt = stamp(input.observedAt);
  const result = decode(await call("service_record_reward_club_claim_proof", { ...args(s), p_idempotency_key: idempotencyKey,
    p_proof: proof, p_witness: witness, p_observed_at: observedAt }, rpc), s);
  const saved = result.proofs.find(p => p.role === s.role);
  demand(saved && saved.idempotencyKey === idempotencyKey && saved.signature === proof.signature && saved.digest === proof.digest
    && saved.wrappedDigest === proof.wrappedDigest && saved.signer === proof.signer);
  return result;
}
