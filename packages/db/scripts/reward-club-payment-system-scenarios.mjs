import assert from "node:assert/strict";
import { readRewardClubPaymentContext, reserveRewardClubPaymentIntent, copyRewardLedgerDocument as copy } from "../dist/rewards/index.js";
import { prepareClubRewardPayment, loadVerifiedClubRewardPayment } from "../../../apps/api/dist/features/rewards/club-payment-service.js";
import { loadVerifiedClubRewardClaimProofs } from "../../../apps/api/dist/features/rewards/club-claim-proof-service.js";
import { readVerifiedRewardClubClaim, encodeRewardClaim } from "../../rewards-chain/dist/index.js";
import { literal } from "./reward-integration-fixture.mjs";
import { fixtureSigner } from "../../rewards-chain/integration/owned-chain.mjs";
import { clubPaymentAttemptSystemScenarios } from "./reward-club-payment-attempt-system-scenarios.mjs";

// Explicitly synthetic local-only signer; no actual send in these scenarios.
// An athlete later reserves the SAME lane in a rolled-back transaction.
export const clubPaymentTestRelayer = fixtureSigner(0xC1AB).address.toLowerCase();

export async function clubPaymentSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, prepared, pendingClaim, deps }) {
  const { rpc, query, scalar, rpcSql, lock, waiting } = harness;
  const request = { claimIntentId: prepared.intentId, relayerAddress: clubPaymentTestRelayer, idempotencyKey: "club-payment-reservation" };
  const reserve = (r = request, overrides = {}) => prepareClubRewardPayment(operator, r, { ...deps, ...overrides });
  const read = () => readRewardClubPaymentContext(operator, request, rpc);
  const count = () => scalar("select count(*) from app_private.reward_club_payment_intents");
  const slots = () => scalar("select count(*) from app_private.reward_relayer_nonce_slots");
  const expired = yes => query(`update auth.sessions set not_after=clock_timestamp()+interval '${yes ? "-1 second" : "1 hour"}' where id=${literal(operator.sessionId)}`);
  const approved = await loadVerifiedClubRewardClaimProofs(operator, { intentId: prepared.intentId, role: "operator" }, deps);
  const observe = () => readVerifiedRewardClubClaim(chain.publicClient, approved.expected, deps.creationCode);
  const sqlArgs = w => ({ p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId, p_claim_intent_id: prepared.intentId,
    p_relayer_address: clubPaymentTestRelayer, p_idempotency_key: request.idempotencyKey, p_observed_chain_id: 31337,
    p_pending_nonce: "0", p_witness: copy(w), p_observed_at: new Date().toISOString() });
  let payment;

  await scenario("club payment preparation requires dual proofs, current Safe consent and a separate EOA gas payer", async () => {
    await assert.rejects(prepareClubRewardPayment(owner, request, deps), { code: "reward_claim_proof_scope_required" });
    await assert.rejects(prepareClubRewardPayment({ ...operator, sessionId: owner.sessionId }, request, deps), { code: "reward_account_session_required" });
    await assert.rejects(reserve({ ...request, claimIntentId: pendingClaim.intentId }), { code: "reward_payment_approvals_required" });
    for (const relayerAddress of [chain.operator.address, chain.treasury, prepared.claim.recipient, prepared.context.verifyingContract])
      await assert.rejects(reserve({ ...request, relayerAddress }), { code: "reward_separate_relayer_required" });
    for (const code of [null, "0x0", "0xef010000", "unavailable"]) {
      const reader = { ...chain.publicClient, getCode: args => args.address.toLowerCase() === clubPaymentTestRelayer ? code : chain.publicClient.getCode(args) };
      await assert.rejects(reserve(request, { reader }), { code: "reward_relayer_eoa_required" });
    }
    const unavailable = { ...chain.publicClient, getCode: args => {
      if (args.address.toLowerCase() === clubPaymentTestRelayer) throw Error("Synthetic private provider diagnostic");
      return chain.publicClient.getCode(args);
    } };
    await assert.rejects(reserve(request, { reader: unavailable }), { code: "reward_payment_observation_unavailable" });
    const oldBlock = approved.context.proofs.find(p => p.role === "recipient").chainWitness.observation.finalizedBlock.number;
    await chain.testClient.mine({ blocks: 96, interval: 1 }); let currentConsentChecked = false;
    const reader = { ...chain.publicClient, readContract: args => {
      if (args.functionName === "isValidSignature" && args.blockNumber > oldBlock) { currentConsentChecked = true; return "0xffffffff"; }
      return chain.publicClient.readContract(args);
    } };
    await assert.rejects(reserve(request, { reader }), { code: "reward_club_consent_invalid" });
    assert.equal(currentConsentChecked, true); assert.equal(await count(), 0); assert.equal(await slots(), 0);
  });

  await scenario("club reservation SQL enforces source, clock, identity, roles and exact original witness; service-role success rolls back", async () => {
    const args = sqlArgs(await observe()), statement = rpcSql("service_reserve_reward_club_payment", args);
    const mapping = await scalar(`select id from public.league_round_race_mappings where league_round_event_id=${literal(entries[0].campaign.scopeKey)} limit 1`);
    await assert.rejects(query(`begin; update public.league_round_race_mappings set current_result_publication_id=null where id=${literal(mapping)}; ${statement} rollback;`), { code: "reward_mapping_source_not_ready" });
    await assert.rejects(query(`begin; update public.user_profiles set locale=case when locale='hr' then 'en' else 'hr' end where user_id=${literal(owner.userId)}; ${statement} rollback;`), { code: "reward_claim_readiness_required" });
    for (const patch of [{ p_observed_at: "2020-01-01T00:00:00Z" }, { p_pending_nonce: "9007199254740992" }, { p_observed_chain_id: 143 }])
      await assert.rejects(query(rpcSql("service_reserve_reward_club_payment", { ...args, ...patch })));
    for (const mutate of [w => { w.award.nonce = "999"; }, w => { w.award.amount = "1"; }, w => { w.treasury.executionNonce = "1"; },
      w => { w.observation.accounting.paused = true; }, w => { w.award.beneficiaryKind = 0; }, w => { w.recipient = chain.treasury.toLowerCase(); }]) {
      const w = copy(args.p_witness); mutate(w);
      await assert.rejects(query(rpcSql("service_reserve_reward_club_payment", { ...args, p_witness: w })));
    }
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${statement} rollback;`));
    const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const body = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${rpcSql("service_reserve_reward_club_payment", { ...args, p_pending_nonce: "7" })} set constraints all immediate; rollback;`));
    assert.equal(body.paymentIntent.nonce, "7"); assert.equal(await count(), 0); assert.equal(await slots(), 0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='app_private.reward_club_payment_intents'::regclass"), true);
    assert.equal(await scalar("select has_table_privilege('authenticated','app_private.reward_club_payment_intents','select')"), false);
    assert.equal(await scalar("select has_table_privilege('service_role','app_private.reward_club_payment_intents','update,delete')"), false);
    assert.equal(await scalar("select count(*) from pg_proc where proname in('service_read_reward_club_payment_context','service_reserve_reward_club_payment','lock_reward_club_payment_context','require_reward_club_payment_ready') and prosecdef"), 0);
  });

  await scenario("club reservation rechecks actual operator sessions after read, programme and insertion waits without consuming a slot", async () => {
    const w = await observe();
    const direct = () => reserveRewardClubPaymentIntent(operator, { ...request, observedChainId: 31337, pendingNonce: 0n, witness: w, observedAt: new Date().toISOString() }, rpc);
    for (const [sql, operation] of [
      ["lock table app_private.reward_club_payment_intents in access exclusive mode", read],
      [`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`, direct],
      ["lock table app_private.reward_club_payment_intents in share mode", direct],
    ]) {
      const unlock = await lock(sql), pending = assert.rejects(operation(), { code: "reward_account_session_required" }); pending.catch(() => {});
      try { await waiting(1); await expired(true); } finally { await unlock(); }
      try { await pending; } finally { await expired(false); }
      assert.equal(await count(), 0); assert.equal(await slots(), 0);
    }
  });

  await scenario("concurrent club payment retries recover a lost commit with one immutable typed relayer slot and no transfer", async () => {
    const unlock = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    let lost = false;
    const rpcLost = async (method, args) => { const r = await rpc(method, args);
      if (method === "service_reserve_reward_club_payment" && !r.error && !lost) { lost = true; throw Error("Synthetic lost reservation response"); }
      return r;
    };
    const pending = Promise.allSettled([reserve(request, { rpc: rpcLost }), reserve()]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const results = await pending;
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1, JSON.stringify(results.map(r => ({ status: r.status, code: r.reason?.code }))));
    assert.equal(results.find(r => r.status === "rejected").reason.code, "reward_ledger_unavailable");
    payment = results.find(r => r.status === "fulfilled").value;
    assert.deepEqual(await reserve(), payment); assert.equal(payment.nonce, 0n); assert.equal(payment.expected.award.beneficiaryKind, 1);
    assert.equal(payment.transaction.value, 0n); assert.equal(payment.transaction.to, prepared.context.verifyingContract);
    assert.equal(payment.transaction.data, encodeRewardClaim(prepared.context, prepared.claim, payment.proofs));
    assert.equal(await count(), 1); assert.equal(await slots(), 1);
    const c = await read(); assert.equal(c.paymentIntent.preparedSessionId, operator.sessionId);
    assert.equal(await scalar("select count(*) from app_private.reward_relayer_nonce_slots where club_payment_intent_id is not null and athlete_payment_intent_id is null"), 1);
    await assert.rejects(reserve({ ...request, idempotencyKey: "club-payment-new-key" }), { code: "reward_payment_already_planned" });
    await assert.rejects(reserve({ ...request, relayerAddress: chain.relayer.address }), { code: "reward_payment_already_planned" });
    await assert.rejects(query("update app_private.reward_club_payment_intents set nonce=99"), { code: "reward_ledger_is_immutable" });
    await assert.rejects(query("delete from app_private.reward_club_payment_intents"), { code: "reward_ledger_is_immutable" });
    await assert.rejects(query(`insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce) values(31337,${literal(clubPaymentTestRelayer)},99)`));
    await assert.rejects(query(`insert into app_private.reward_relayer_nonce_slots(chain_id,relayer_address,nonce,club_payment_intent_id)
      values(31337,${literal(clubPaymentTestRelayer)},99,${literal(payment.paymentIntentId)})`));
    await assert.rejects(query(`insert into app_private.reward_operator_nonce_slots(chain_id,operator_address,nonce,campaign_id,deployment_intent_id)
      select chain_id,${literal(clubPaymentTestRelayer)},999,campaign_id,id from app_private.reward_deployment_intents limit 1`), { code: "reward_separate_relayer_required" });
    assert.equal(await chain.publicClient.getTransactionCount({ address: clubPaymentTestRelayer }), 0);
    assert.equal(await chain.publicClient.getBalance({ address: prepared.claim.recipient }), 0n);
  });

  await scenario("private club payment reload reverifies both capabilities and rejects mutated stored identity, nonce and witness", async () => {
    const lookup = { claimIntentId: prepared.intentId, paymentIntentId: payment.paymentIntentId };
    assert.deepEqual(await loadVerifiedClubRewardPayment(operator, lookup, deps), payment);
    for (const mutate of [c => { c.paymentIntent.operatorProofId = c.paymentIntent.recipientProofId; }, c => { c.paymentIntent.nonce = "9007199254740992"; },
      c => { c.paymentIntent.preparedByUserId = owner.userId; }, c => { c.paymentIntent.relayerAddress = prepared.claim.recipient.toLowerCase(); },
      c => { c.paymentIntent.chainWitness.observation.accounting.paused = true; }, c => { c.paymentIntent.chainWitness.treasury.executionNonce = "1"; },
      c => { c.paymentIntent.chainWitness.award.beneficiaryKind = 0; }, c => { c.paymentIntent.chainWitness.award.amount = "1"; },
      c => { c.claimContext.proofs.find(p => p.role === "operator").signature = `0x${"ff".repeat(65)}`; }]) {
      const corrupt = async (method, args) => { const r = await rpc(method, args); if (method === "service_read_reward_club_payment_context" && !r.error) mutate(r.data); return r; };
      await assert.rejects(loadVerifiedClubRewardPayment(operator, lookup, { ...deps, rpc: corrupt }));
    }
    const unavailable = { ...chain.publicClient, getBlock: () => { throw Error("Synthetic archive failure"); } };
    await assert.rejects(loadVerifiedClubRewardPayment(operator, lookup, { ...deps, reader: unavailable }));
    assert.equal(await count(), 1); assert.equal(await slots(), 1);
  });
  const attemptsAfterRevocation = await clubPaymentAttemptSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, payment, deps,
    signer: fixtureSigner(0xC1AB) });
  return async function afterRevocation() {
    assert.equal((await read()).claimContext.claimContext.reviewContext.reviewState, "revoked");
    assert.deepEqual(await reserve(), payment, "History does not renew approval or its original time window");
    const w = await observe();
    assert.equal((await reserveRewardClubPaymentIntent(operator, { ...request, observedChainId: 31337, pendingNonce: 99n, witness: w, observedAt: new Date().toISOString() }, rpc)).paymentIntent.nonce, 0n);
    assert.equal(await count(), 1); assert.equal(await slots(), 1);
    await attemptsAfterRevocation();
  };
}
