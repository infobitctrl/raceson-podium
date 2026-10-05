import assert from "node:assert/strict";
import test from "node:test";
import { decodeRewardClubClaimProof, readRewardClubClaimProofs, storeRewardClubClaimProof } from "../../../packages/db/dist/rewards/index.js";
import { submitClubRewardClaimProof } from "../dist/features/rewards/club-claim-proof-service.js";
const id = n => `7c500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) }, input = { intentId: id(3), role: "recipient" };
const proof = () => ({ role: "recipient", signer: `0x${"ab".repeat(20)}`, digest: `0x${"cd".repeat(32)}`,
  wrappedDigest: `0x${"ef".repeat(32)}`, signature: `0x${"01".repeat(130)}` });
test("club proof shape keeps Safe wrapped consent distinct from the campaign authorization digest", () => {
  const p = proof(); assert.deepEqual(decodeRewardClubClaimProof(p), p);
  const operator = { ...p, role: "operator", wrappedDigest: null, signature: `0x${"02".repeat(65)}` };
  assert.deepEqual(decodeRewardClubClaimProof(operator), operator);
  assert.equal(decodeRewardClubClaimProof({ ...p, signature: `0x${"01".repeat(8192)}` }).signature.length, 16386);
});
test("club proof shape refuses unbounded, malformed, unwrapped or role-confused capabilities", () => {
  for (const patch of [{ role: "admin" }, { wrappedDigest: null }, { wrappedDigest: `0x${"00".repeat(32)}` },
    { signature: "0x" }, { signature: "0x1" }, { signature: `0x${"01".repeat(8193)}` }, { signer: id(4) }, { extra: true },
    { role: "operator" }, { role: "operator", wrappedDigest: null }]) assert.throws(() => decodeRewardClubClaimProof({ ...proof(), ...patch }));
});
test("club signature submission rejects malformed scope/signature before reading SQL or chain", async () => {
  let calls = 0; const rpc = async () => { calls++; throw Error("Must not contact SQL"); };
  const deps = { chainId: 31337, rpc, reader: {}, creationCode: "0x" };
  for (const patch of [{ intentId: "bad" }, { role: "admin" }, { idempotencyKey: "tiny" }, { signature: "0x1" },
    { signature: `0x${"11".repeat(8193)}` }, { role: "operator", signature: proof().signature }]) {
    await assert.rejects(submitClubRewardClaimProof(identity, { ...input, idempotencyKey: "valid-proof-key", signature: proof().signature, ...patch }, deps));
  }
  await assert.rejects(storeRewardClubClaimProof(identity, { ...input, idempotencyKey: "valid-proof-key", proof: proof(), witness: {}, observedAt: "2026-09-09T00:00:00Z" }, rpc));
  assert.equal(calls, 0);
});
test("private club proof reads freeze caller/session/intent and sanitize transport failures", async () => {
  const actor = { ...identity }, request = { ...input }; let sent;
  const pending = readRewardClubClaimProofs(actor, request, async (method, args) => {
    assert.equal(method, "service_read_reward_club_claim_proofs"); sent = args; await Promise.resolve();
    return { data: null, error: { message: "reward_claim_proof_scope_required" } };
  });
  actor.userId = id(9); request.intentId = id(8);
  await assert.rejects(pending, { code: "reward_claim_proof_scope_required" });
  assert.equal(sent.p_actor_user_id, identity.userId); assert.equal(sent.p_actor_session_id, identity.sessionId); assert.equal(sent.p_intent_id, input.intentId);
  await assert.rejects(readRewardClubClaimProofs(identity, input, async () => ({ data: null, error: { message: "private SQL diagnostics" } })), { code: "reward_ledger_store_failed" });
  await assert.rejects(readRewardClubClaimProofs(identity, input, async () => { throw Error("secret RPC token"); }), { code: "reward_ledger_unavailable" });
});
