import assert from "node:assert/strict";
import test from "node:test";
import { readRewardClubPaymentContext, reserveRewardClubPaymentIntent, decodeRewardClubPaymentContext,
  readRewardClubPaymentAttempt, storeRewardClubPaymentAttempt } from "../../../packages/db/dist/rewards/index.js";
import { prepareClubRewardPayment, loadVerifiedClubRewardPayment, loadVerifiedClubRewardPaymentAttempt,
  recordSignedClubRewardPayment, observeFreshClubRewardPayment } from "../dist/features/rewards/club-payment-service.js";

const id = n => `7c600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { userId: id(1), sessionId: id(2) };
const input = { claimIntentId: id(3), relayerAddress: `0x${"ac".repeat(20)}`, idempotencyKey: "club-payment-test" };

test("club payment preparation rejects malformed scope and gas-payer inputs before SQL or chain access", async () => {
  let calls = 0; const rpc = async () => { calls++; throw Error("Unexpected SQL"); };
  const deps = { chainId: 31337, rpc, reader: {}, creationCode: "0x" };
  for (const patch of [{ claimIntentId: "bad" }, { idempotencyKey: null }, { idempotencyKey: "short" },
    { idempotencyKey: "x".repeat(129) }, { relayerAddress: null }, { relayerAddress: "0x01" },
    { relayerAddress: `0x${"0".repeat(40)}` }, { relayerAddress: `0x${"0".repeat(39)}1` }])
    await assert.rejects(prepareClubRewardPayment(identity, { ...input, ...patch }, deps));
  await assert.rejects(prepareClubRewardPayment({ ...identity, sessionId: "bad" }, input, deps));
  await assert.rejects(loadVerifiedClubRewardPayment(identity, { ...input, paymentIntentId: "bad" }, deps));
  assert.equal(calls, 0);
});

test("club payment reads freeze the real caller and sanitize SQL/transport failures", async () => {
  const actor = { ...identity }, request = { ...input }; let sent;
  const pending = readRewardClubPaymentContext(actor, request, async (method, args) => {
    assert.equal(method, "service_read_reward_club_payment_context"); sent = args; await Promise.resolve();
    return { data: null, error: { message: "reward_claim_proof_scope_required" } };
  });
  actor.userId = id(9); actor.sessionId = id(8); request.claimIntentId = id(7);
  await assert.rejects(pending, { code: "reward_claim_proof_scope_required" });
  assert.deepEqual(sent, { p_actor_user_id: identity.userId, p_actor_session_id: identity.sessionId, p_claim_intent_id: input.claimIntentId });
  await assert.rejects(readRewardClubPaymentContext(identity, input, async () => ({ data: null, error: { message: "private SQL detail" } })), { code: "reward_ledger_store_failed" });
  await assert.rejects(readRewardClubPaymentContext(identity, input, async () => { throw Error("private RPC token"); }), { code: "reward_ledger_unavailable" });
});

test("club payment repository refuses invalid nonce, chain and absent verified witness without reserving", async () => {
  let calls = 0; const rpc = async () => { calls++; throw Error("Unexpected SQL"); };
  const request = { ...input, observedChainId: 31337, pendingNonce: 0n, witness: {}, observedAt: "2026-09-09T00:00:00Z" };
  for (const patch of [{}, { observedChainId: 143 }, { pendingNonce: -1n }, { pendingNonce: 0 },
    { pendingNonce: 9007199254740992n }, { observedAt: "invalid" }])
    await assert.rejects(reserveRewardClubPaymentIntent(identity, { ...request, ...patch }, rpc));
  assert.equal(calls, 0);
});

test("club payment decoding requires a complete exact private claim/proof context", () => {
  for (const value of [null, [], {}, { claimContext: {}, paymentIntent: null },
    { claimContext: {}, paymentIntent: null, extra: true }])
    assert.throws(() => decodeRewardClubPaymentContext(value, identity, input.claimIntentId));
});

test("club signed-attempt services reject malformed scope and selectors without SQL or chain calls", async () => {
  let calls = 0; const rpc = async () => { calls++; throw Error("Unexpected SQL"); };
  const deps = { chainId: 31337, rpc, reader: {}, creationCode: "0x" }, r = { claimIntentId: input.claimIntentId, paymentIntentId: id(4), attemptId: id(5) };
  for (const operation of [loadVerifiedClubRewardPaymentAttempt, observeFreshClubRewardPayment])
    for (const field of ["claimIntentId", "paymentIntentId", "attemptId"]) await assert.rejects(operation(identity, { ...r, [field]: "bad" }, deps));
  for (const patch of [{ claimIntentId: "bad" }, { paymentIntentId: "bad" }, { idempotencyKey: null }, { idempotencyKey: "short" }, { idempotencyKey: "x".repeat(129) }])
    await assert.rejects(recordSignedClubRewardPayment(identity, { ...r, idempotencyKey: "signed-club-test", signedTransaction: "0x02ab", ...patch }, deps));
  for (const patch of [{ attemptId: undefined }, { idempotencyKey: "lookup-both" }, { attemptId: "bad" }])
    await assert.rejects(readRewardClubPaymentAttempt(identity, { ...r, ...patch }, rpc));
  await assert.rejects(storeRewardClubPaymentAttempt(identity, { ...r, idempotencyKey: "signed-club-test", attempt: {}, pendingNonce: 0n, witness: {}, observedAt: "2026-09-09T00:00:00Z" }, rpc));
  assert.equal(calls, 0);
});

test("club attempt lookup freezes caller scope, sanitizes errors and accepts null only for a retry-key lookup", async () => {
  const actor = { ...identity }, request = { claimIntentId: input.claimIntentId, paymentIntentId: id(4), idempotencyKey: "signed-club-test" }; let sent;
  const pending = readRewardClubPaymentAttempt(actor, request, async (method, args) => {
    assert.equal(method, "service_read_reward_club_payment_attempt"); sent = args; await Promise.resolve(); return { data: null, error: null };
  });
  actor.userId = id(9); request.paymentIntentId = id(8); request.idempotencyKey = "changed-after-await";
  assert.equal(await pending, null);
  assert.equal(sent.p_actor_user_id, identity.userId); assert.equal(sent.p_payment_intent_id, id(4)); assert.equal(sent.p_idempotency_key, "signed-club-test");
  const r = { claimIntentId: input.claimIntentId, paymentIntentId: id(4), attemptId: id(5) };
  await assert.rejects(readRewardClubPaymentAttempt(identity, r, async () => ({ data: null, error: null })), { code: "invalid_reward_club_payment_document" });
  await assert.rejects(readRewardClubPaymentAttempt(identity, r, async () => ({ data: null, error: { message: "reward_payment_attempt_required" } })), { code: "reward_payment_attempt_required" });
  await assert.rejects(readRewardClubPaymentAttempt(identity, r, async () => ({ data: null, error: { message: "private SQL data" } })), { code: "reward_ledger_store_failed" });
  await assert.rejects(readRewardClubPaymentAttempt(identity, r, async () => { throw Error("private token"); }), { code: "reward_ledger_unavailable" });
});
