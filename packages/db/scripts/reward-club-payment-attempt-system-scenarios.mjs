import assert from "node:assert/strict";
import { readRewardClubPaymentAttempt, storeRewardClubPaymentAttempt, copyRewardLedgerDocument as copy } from "../dist/rewards/index.js";
import { recordSignedClubRewardPayment, loadVerifiedClubRewardPaymentAttempt, observeFreshClubRewardPayment } from "../../../apps/api/dist/features/rewards/club-payment-service.js";
import { verifySignedRewardClubPayment, readVerifiedRewardClubClaim } from "../../rewards-chain/dist/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { clubPaymentJobSystemScenarios } from "./reward-club-payment-job-system-scenarios.mjs";

// Real PostgreSQL and local original Safe verification. All signing accounts
// and sporting rows are synthetic. No transaction is broadcast by this file.
export async function clubPaymentAttemptSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, payment, deps, signer }) {
  const { rpc, query, scalar, rpcSql, lock, waiting } = harness;
  const scope = { claimIntentId: payment.claimIntentId, paymentIntentId: payment.paymentIntentId };
  const sign = (patch = {}) => signer.signTransaction({ ...payment.transaction, type: "eip1559", gas: 2_000_000n,
    maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 100_000_000n, ...patch });
  const signedTransaction = await sign(), verified = await verifySignedRewardClubPayment(chain.publicClient, payment, signedTransaction);
  assert.equal(Object.keys(verified).length, 28);
  const request = { ...scope, idempotencyKey: "club-signed-attempt", signedTransaction };
  const record = (r = request, extra = {}) => recordSignedClubRewardPayment(operator, r, { ...deps, ...extra });
  const count = () => scalar("select count(*) from app_private.reward_club_payment_attempts");
  const observe = () => readVerifiedRewardClubClaim(chain.publicClient, payment.expected, deps.creationCode);
  const sqlArgs = async (patch = {}) => ({ p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId,
    p_claim_intent_id: scope.claimIntentId, p_payment_intent_id: scope.paymentIntentId, p_idempotency_key: request.idempotencyKey,
    p_attempt: copy(verified), p_pending_nonce: "0", p_witness: copy(await observe()), p_observed_at: new Date().toISOString(), ...patch });
  const expired = yes => query(`update auth.sessions set not_after=clock_timestamp()+interval '${yes ? "-1 second" : "1 hour"}' where id=${literal(operator.sessionId)}`);
  let saved, variant;

  await scenario("signed club storage rejects wrong signed economics, current Safe consent and consumed relayer nonce before writing", async () => {
    await assert.rejects(recordSignedClubRewardPayment(owner, request, deps), { code: "reward_claim_proof_scope_required" });
    for (const [patch, code] of [
      [{ nonce: Number(payment.nonce + 1n) }, "reward_payment_nonce_mismatch"], [{ value: 1n }, "reward_payment_input_mismatch"],
      [{ data: "0x" }, "reward_payment_input_mismatch"], [{ chainId: 10143 }, "reward_payment_transaction_chain_mismatch"],
      [{ to: chain.treasury }, "reward_payment_destination_mismatch"],
    ]) await assert.rejects(record({ ...request, signedTransaction: await sign(patch) }), { code });
    const wrongSigner = await chain.relayer.signTransaction({ ...payment.transaction, type: "eip1559", gas: 2_000_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1n });
    await assert.rejects(record({ ...request, signedTransaction: wrongSigner }), { code: "reward_payment_sender_mismatch" });
    await assert.rejects(record(request, { reader: { ...chain.publicClient, getTransactionCount: () => 1 } }), { code: "reward_payment_nonce_consumed" });
    const oldBlock = payment.consentCheckpoint.number; await chain.testClient.mine({ blocks: 96, interval: 1 }); let currentConsentChecked = false;
    const reader = { ...chain.publicClient, readContract: args => {
      if (args.functionName === "isValidSignature" && args.blockNumber > oldBlock) { currentConsentChecked = true; return "0xffffffff"; }
      return chain.publicClient.readContract(args);
    } };
    await assert.rejects(record(request, { reader }), { code: "reward_club_consent_invalid" });
    assert.equal(currentConsentChecked, true); assert.equal(await count(), 0);
  });

  await scenario("club attempt SQL binds all signed fields and source/session evidence with private immutable grants", async () => {
    const args = await sqlArgs(), statement = rpcSql("service_record_reward_club_payment_attempt", args);
    const mapping = await scalar(`select id from public.league_round_race_mappings where league_round_event_id=${literal(entries[0].campaign.scopeKey)} limit 1`);
    await assert.rejects(query(`begin; update public.league_round_race_mappings set current_result_publication_id=null where id=${literal(mapping)}; ${statement} rollback;`), { code: "reward_mapping_source_not_ready" });
    await assert.rejects(query(`begin; update public.user_profiles set locale=case when locale='hr' then 'en' else 'hr' end where user_id=${literal(owner.userId)}; ${statement} rollback;`), { code: "reward_claim_readiness_required" });
    for (const [patch, code] of [[{ p_pending_nonce: "1" }, "reward_payment_nonce_consumed"], [{ p_observed_at: "2020-01-01T00:00:00Z" }, "reward_claim_observation_stale"],
      [{ p_pending_nonce: "9007199254740992" }, "invalid_reward_payment_request"], [{ p_pending_nonce: null }, "invalid_reward_payment_request"]])
      await assert.rejects(query(rpcSql("service_record_reward_club_payment_attempt", { ...args, ...patch })), { code });
    for (const mutate of [a => { a.extra = true; }, a => { delete a.safeBuildId; }, a => { a.action = "pay_athlete"; },
      a => { a.amount = "1"; }, a => { a.recipient = chain.treasury.toLowerCase(); }, a => { a.chainId = 143; }, a => { a.authorizationNonce = "99"; },
      a => { a.safeExecutionNonce = "1"; }, a => { a.safeBuildId = "different-safe"; }, a => { a.wrappedRecipientDigest = a.operatorDigest; },
      a => { a.consentCheckpoint.number = "1"; }, a => { a.consentCheckpoint.extra = "unexpected"; }, a => { a.consentCheckpoint = null; },
      a => { a.nonce = "1"; }, a => { a.nonce = 0; }, a => { a.operatorDigest = a.recipientDigest; }, a => { a.value = "1"; },
      a => { a.gasLimit = "0"; }, a => { a.gasLimit = "18446744073709551616"; }, a => { a.maxPriorityFeePerGas = "9999999999999"; },
      a => { a.signedTransaction = "0x02f"; }, a => { a.signedTransaction = `0x02${"ab".repeat(12289)}`; }, a => { a.signedTransaction = "0x02AA"; }]) {
      const a = copy(args.p_attempt); mutate(a);
      await assert.rejects(query(rpcSql("service_record_reward_club_payment_attempt", { ...args, p_attempt: a })));
    }
    const badWitness = copy(args.p_witness); badWitness.treasury.executionNonce = "1";
    await assert.rejects(query(rpcSql("service_record_reward_club_payment_attempt", { ...args, p_witness: badWitness })));
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${statement} rollback;`));
    const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const body = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${statement} rollback;`));
    assert.equal(body.transactionHash, verified.transactionHash); assert.equal(await count(), 0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='app_private.reward_club_payment_attempts'::regclass"), true);
    assert.equal(await scalar("select has_table_privilege('authenticated','app_private.reward_club_payment_attempts','select')"), false);
    assert.equal(await scalar("select has_table_privilege('service_role','app_private.reward_club_payment_attempts','update,delete')"), false);
    assert.equal(await scalar("select count(*) from pg_proc where proname in('service_record_reward_club_payment_attempt','service_read_reward_club_payment_attempt') and (prosecdef or not coalesce(proconfig @> array['search_path=\"\"'],false))"), 0);
  });

  await scenario("club attempt writes and missing-key reads recheck real operator sessions after SQL waits", async () => {
    const direct = async () => storeRewardClubPaymentAttempt(operator, { ...scope, idempotencyKey: request.idempotencyKey,
      attempt: verified, pendingNonce: 0n, witness: await observe(), observedAt: new Date().toISOString() }, rpc);
    for (const [sql, operation] of [
      [`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`, direct],
      ["lock table app_private.reward_club_payment_attempts in share mode", direct],
      ["lock table app_private.reward_club_payment_attempts in access exclusive mode", () => readRewardClubPaymentAttempt(operator, { ...scope, idempotencyKey: request.idempotencyKey }, rpc)],
    ]) {
      const unlock = await lock(sql), pending = assert.rejects(operation(), { code: "reward_account_session_required" }); pending.catch(() => {});
      try { await waiting(1); await expired(true); } finally { await unlock(); }
      try { await pending; } finally { await expired(false); }
      assert.equal(await count(), 0);
    }
  });

  await scenario("concurrent signed club retries recover one lost commit and preserve exact bytes without any broadcast", async () => {
    let lost = false;
    const rpcLost = async (method, args) => { const r = await rpc(method, args);
      if (method === "service_record_reward_club_payment_attempt" && !r.error && !lost) { lost = true; throw Error("Synthetic lost signed-attempt response"); }
      return r;
    };
    const unlock = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    const pending = Promise.allSettled([record(request, { rpc: rpcLost }), record()]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const results = await pending;
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1, JSON.stringify(results.map(r => ({ status: r.status, code: r.reason?.code }))));
    assert.equal(results.find(r => r.status === "rejected").reason.code, "reward_ledger_unavailable");
    saved = results.find(r => r.status === "fulfilled").value;
    assert.deepEqual(await record(), saved); assert.equal(await count(), 1);
    const read = await readRewardClubPaymentAttempt(operator, { ...scope, attemptId: saved.attemptId }, rpc);
    assert.equal(read.attempt.recordedSessionId, operator.sessionId); assert.equal(read.attempt.body.signedTransaction, signedTransaction);
    assert.deepEqual((await loadVerifiedClubRewardPaymentAttempt(operator, { ...scope, attemptId: saved.attemptId }, deps)).verified, verified);
    assert.equal((await observeFreshClubRewardPayment(operator, { ...scope, attemptId: saved.attemptId }, deps)).witness.award.paid, false);
    await assert.rejects(record({ ...request, idempotencyKey: "same-bytes-new-key" }), { code: "reward_payment_transaction_already_recorded" });
    const fees = await sign({ maxFeePerGas: 30_000_000_000n });
    await assert.rejects(record({ ...request, signedTransaction: fees }), { code: "reward_ledger_idempotency_conflict" });
    variant = await record({ ...request, idempotencyKey: "club-signed-variant", signedTransaction: fees });
    assert.notEqual(variant.attemptId, saved.attemptId); assert.equal(await count(), 2);
    const fake = copy(verified); fake.calldataHash = `0x${"12".repeat(32)}`; fake.transactionHash = `0x${"13".repeat(32)}`;
    await assert.rejects(query(rpcSql("service_record_reward_club_payment_attempt", await sqlArgs({ p_idempotency_key: "changed-call-hash", p_attempt: fake }))), { code: "reward_payment_attempt_mismatch" });
    await assert.rejects(query("update app_private.reward_club_payment_attempts set idempotency_key='changed-attempt'"), { code: "reward_ledger_is_immutable" });
    await assert.rejects(query("delete from app_private.reward_club_payment_attempts"), { code: "reward_ledger_is_immutable" });
    assert.equal(await chain.publicClient.getTransactionCount({ address: signer.address }), 0);
    assert.equal(await chain.publicClient.getBalance({ address: payment.claim.recipient }), 0n);
  });

  await scenario("private club signed-byte reload rejects corrupt bindings, fee metadata, signature bytes and unavailable history", async () => {
    const lookup = { ...scope, attemptId: saved.attemptId };
    for (const mutate of [r => { r.attempt.recordedByUserId = owner.userId; }, r => { r.attempt.paymentIntentId = owner.userId; },
      r => { r.attempt.body.safeExecutionNonce = "1"; }, r => { r.attempt.body.wrappedRecipientDigest = verified.operatorDigest; },
      r => { r.attempt.body.consentCheckpoint.hash = `0x${"12".repeat(32)}`; }, r => { r.attempt.body.nonce = "1"; },
      r => { r.attempt.body.gasLimit = "2000001"; }, r => { r.attempt.body.maxFeePerGas = "2000000001"; },
      r => { r.attempt.body.signedTransaction = "0x02ab"; }, r => { r.attempt.body.extra = true; },
      r => { r.context.claimContext.proofs.find(p => p.role === "operator").signature = `0x${"ff".repeat(65)}`; }]) {
      const corrupt = async (method, args) => { const r = await rpc(method, args); if (method === "service_read_reward_club_payment_attempt" && !r.error) mutate(r.data); return r; };
      await assert.rejects(loadVerifiedClubRewardPaymentAttempt(operator, lookup, { ...deps, rpc: corrupt }));
    }
    await assert.rejects(loadVerifiedClubRewardPaymentAttempt(operator, lookup, { ...deps, reader: { ...chain.publicClient, getBlock: () => { throw Error("Synthetic archive unavailable"); } } }));
    const unlock = await lock("lock table app_private.reward_club_payment_attempts in access exclusive mode");
    const pending = assert.rejects(readRewardClubPaymentAttempt(operator, lookup, rpc), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await expired(true); } finally { await unlock(); }
    try { await pending; } finally { await expired(false); }
    assert.equal(await count(), 2);
  });

  // Leaves the exact transaction pending; revocation below happens before
  // mining. Historical signed-attempt checks still exercise the unpaid state.
  const confirmAfterRevocation = await clubPaymentJobSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, payment, deps, signer,
    attempt: saved, variant, signedTransaction });
  return async function afterRevocation() {
    await scenario("revoked club review preserves signed history and exact retries but refuses new variants and fresh execution", async () => {
      assert.deepEqual(await record(), saved);
      const lookup = { ...scope, attemptId: saved.attemptId };
      assert.deepEqual((await loadVerifiedClubRewardPaymentAttempt(operator, lookup, deps)).verified, verified);
      await assert.rejects(observeFreshClubRewardPayment(operator, lookup, deps), { code: "reward_claim_readiness_required" });
      await assert.rejects(record({ ...request, idempotencyKey: "revoked-new-variant", signedTransaction: await sign({ maxFeePerGas: 40_000_000_000n }) }), { code: "reward_claim_readiness_required" });
      const args = await sqlArgs({ p_pending_nonce: "99", p_observed_at: "2020-01-01T00:00:00Z" });
      const old = JSON.parse(await query(rpcSql("service_record_reward_club_payment_attempt", args)));
      assert.equal(old.attemptId, saved.attemptId, "An exact old retry is history, not renewed authority");
      await assert.rejects(query(rpcSql("service_record_reward_club_payment_attempt", { ...args, p_idempotency_key: "revoked-sql-write" })), { code: "reward_claim_readiness_required" });
      assert.equal(await count(), 2); assert.notEqual(saved.transactionHash, variant.transactionHash);
      assert.equal(await scalar("select count(*) from app_private.reward_club_payment_intents"), 1);
      assert.equal(await chain.publicClient.getBalance({ address: payment.claim.recipient }), 0n);
    });
    await confirmAfterRevocation();
  };
}
