import assert from "node:assert/strict";
import { TransactionNotFoundError } from "viem";
import { queueVerifiedClubRewardPayment } from "../../../apps/api/dist/features/rewards/club-payment-worker.js";
import { runStoredRewardOperatorJob } from "../../../apps/api/dist/features/rewards/operator-runner.js";
import { readRewardClubPaymentJob, stepRewardClubPaymentJob, nextRewardOperatorJob, copyRewardLedgerDocument as copy } from "../dist/rewards/index.js";
import { observeFreshClubRewardPayment } from "../../../apps/api/dist/features/rewards/club-payment-service.js";
import { readVerifiedRewardClubPayment } from "../../rewards-chain/dist/index.js";
import { createRewardOperatorProcess } from "./reward-operator-process.mjs";
import { calculationFixture, rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { clubPortalSystemScenarios } from "./reward-club-portal-system-scenarios.mjs";

// Actual private queue/session runner, PostgreSQL, original Safe and owned
// loopback chain. Synthetic signer only; no remotely supplied key or chain.
export async function clubPaymentJobSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, payment, deps, signer, attempt, variant, signedTransaction }) {
  const { rpc, query, scalar, rpcSql, lock, waiting } = harness;
  const scope = { claimIntentId: payment.claimIntentId, paymentIntentId: payment.paymentIntentId, attemptId: attempt.attemptId, idempotencyKey: "club-payment-job" };
  const gasPolicy = { maxGasLimit: 2_000_000n, maxFeePerGas: 30_000_000_000n, maxTotalFeeWei: 100_000_000_000_000_000n, minimumRemainingBalanceWei: 1000000n };
  let sends = 0, job;
  const config = { ...deps, origin: "http://127.0.0.1:5173", gasPolicy, broadcast: async signed => {
    assert.equal(signed, signedTransaction); sends++; return chain.relayerClient.sendRawTransaction({ serializedTransaction: signed });
  } };
  await chain.testClient.setBalance({ address: signer.address, value: 10n ** 18n });
  const session = calculationFixture().session, workerId = id(99511);
  const read = () => readRewardClubPaymentJob(operator, { jobId: job.jobId }, rpc);
  const expire = () => query(`update app_private.reward_club_payment_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${literal(job.jobId)}`);
  const run = (overrides = {}, worker = workerId) => runStoredRewardOperatorJob(session, operator,
    { kind: "club_payment", jobId: job.jobId, campaignId: job.campaignId, intentId: job.paymentIntentId, attemptId: job.attemptId,
      transactionHash: job.transactionHash, signerAddress: signer.address.toLowerCase(), nonce: payment.nonce, state: job.state },
    { programmeId, workerId: worker, maxJobs: 1, deadlineMs: Date.now() + 60000 }, { ...config, ...overrides });

  await scenario("club job queue freezes one exact attempt, requires confirmed activation and remains private", async () => {
    await assert.rejects(queueVerifiedClubRewardPayment(owner, scope, config), { code: "reward_claim_proof_scope_required" });
    const result = await Promise.all([queueVerifiedClubRewardPayment(operator, scope, config), queueVerifiedClubRewardPayment(operator, scope, config)]);
    assert.deepEqual(result[0], result[1]); job = result[0]; assert.equal(job.state, "queued"); assert.equal(job.transactionHash, attempt.transactionHash);
    assert.deepEqual(await queueVerifiedClubRewardPayment(operator, scope, config), job);
    await assert.rejects(queueVerifiedClubRewardPayment(operator, { ...scope, attemptId: variant.attemptId }, config), { code: "reward_payment_job_already_queued" });
    await assert.rejects(queueVerifiedClubRewardPayment(operator, { ...scope, idempotencyKey: "another-club-job" }, config), { code: "reward_payment_job_already_queued" });
    const selected = await nextRewardOperatorJob(operator, { programmeId, chainId: 31337, excludedSigners: [] }, rpc);
    assert.equal(selected.kind, "club_payment"); assert.equal(selected.jobId, job.jobId); assert.equal(selected.nonce, 0n);
    assert.equal(await nextRewardOperatorJob(operator, { programmeId, chainId: 31337, excludedSigners: [signer.address.toLowerCase()] }, rpc), null);
    assert.equal(await scalar(`select state from app_private.reward_lifecycle_jobs where id=${literal(job.activationJobId)}`), "confirmed");
    assert.equal(await scalar("select count(*) from app_private.reward_club_payment_job_events"), 1);
    for (const table of ["reward_club_payment_jobs", "reward_club_payment_job_events", "reward_club_payment_confirmations"]) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='app_private.${table}'::regclass`), true);
      assert.equal(await scalar(`select has_table_privilege('authenticated','app_private.${table}','select')`), false);
    }
    await assert.rejects(query(`update app_private.reward_club_payment_jobs set attempt_id=${literal(variant.attemptId)} where id=${literal(job.jobId)}`), { code: "reward_job_identity_is_immutable" });
    const r = { p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId, p_job_id: job.jobId, p_payment_intent_id: null };
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${rpcSql("service_read_reward_club_payment_job", r)} rollback;`));
    assert.equal(sends, 0);
  });

  await scenario("club worker leases fence competitors and expose the active lane to athlete exclusion; stale tokens cannot execute", async () => {
    const lease = await stepRewardClubPaymentJob(operator, { jobId: job.jobId, workerId, leaseToken: null, action: "lease" }, rpc);
    assert.equal((await run({}, id(99512))).outcome, "busy");
    assert.equal(await scalar(`select app_private.reward_relayer_lane_busy(31337,${literal(signer.address.toLowerCase())},'athlete',${literal(id(99513))})`), true);
    assert.equal(await scalar(`select app_private.reward_relayer_lane_busy(31337,${literal(signer.address.toLowerCase())},'club',${literal(job.jobId)})`), false);
    assert.equal(await scalar(`select app_private.reward_relayer_lane_busy(10143,${literal(signer.address.toLowerCase())},'athlete',${literal(id(99513))})`), false);
    await expire();
    await assert.rejects(stepRewardClubPaymentJob(operator, { jobId: job.jobId, workerId, leaseToken: lease.leaseToken, action: "submitted" }, rpc), { code: "reward_payment_job_lease_lost" });
    assert.equal((await run({ gasPolicy: { ...gasPolicy, maxGasLimit: 1n } })).outcome, "gas_guard");
    assert.equal((await run({ reader: { ...chain.publicClient, getChainId: () => 143 } })).outcome, "unavailable");
    const rejectConsent = { ...chain.publicClient, readContract: args => args.functionName === "isValidSignature" && args.blockNumber > payment.consentCheckpoint.number
      ? "0xffffffff" : chain.publicClient.readContract(args) };
    assert.equal((await run({ reader: rejectConsent })).outcome, "not_ready");
    assert.equal(sends, 0); assert.equal((await read()).mayHaveBroadcast, false);
    const live = await observeFreshClubRewardPayment(operator, scope, config), current = await read();
    const x = { schemaVersion: 1, claimWitness: live.witness, latestNonce: 0n, pendingNonce: 0n, relayerBalanceWei: 10n ** 18n, estimatedGas: 200000n, gasPolicy };
    const args = { p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId, p_job_id: job.jobId, p_worker_id: workerId,
      p_lease_token: current.leaseToken, p_action: "arm", p_execution: copy(x), p_observed_at: new Date().toISOString() };
    const mapping = await scalar(`select id from public.league_round_race_mappings where league_round_event_id=${literal(entries[0].campaign.scopeKey)} limit 1`);
    await assert.rejects(query(`begin; update public.league_round_race_mappings set current_result_publication_id=null where id=${literal(mapping)};
      ${rpcSql("service_step_reward_club_payment_job", args)} rollback;`), { code: "reward_mapping_source_not_ready" });
    for (const mutate of [w => { w.pendingNonce = "1"; }, w => { w.estimatedGas = "9999999"; }, w => { w.claimWitness.treasury.executionNonce = "1"; }]) {
      const w = copy(x); mutate(w); await assert.rejects(query(rpcSql("service_step_reward_club_payment_job", { ...args, p_execution: w })));
    }
    const delayed = async (name, a) => { const r = await rpc(name, a);
      if (name === "service_reward_operator_session_call" && a.p_method === "service_step_reward_club_payment_job" && a.p_arguments.p_action === "arm" && !r.error) {
        await expire(); r.data.result.leaseExpiresAt = "2020-01-01T00:00:00Z";
      } return r;
    };
    assert.equal((await run({ rpc: delayed })).outcome, "busy"); assert.equal(sends, 0);
  });

  await scenario("an authenticated club operator killed after send recovers the exact pending transaction without a second broadcast", async () => {
    const childRun = createRewardOperatorProcess({ ...config, identity: operator, programmeId });
    await expire(); await chain.testClient.setAutomine(false);
    const killed = await childRun({ crashAt: "after_broadcast", jobId: job.jobId });
    assert.equal(killed.signal, "SIGKILL"); assert.equal(sends, 1); assert.equal((await read()).mayHaveBroadcast, true);
    const busy = await childRun(); assert.deepEqual(busy.result.entries, [{ kind: "club_payment", jobId: job.jobId, outcome: "busy" }]);
    await expire(); const recovered = await childRun();
    assert.notEqual(recovered.pid, killed.pid); assert.deepEqual(recovered.result.entries, [{ kind: "club_payment", jobId: job.jobId, outcome: "pending" }]);
    assert.equal(sends, 1); await expire();
    const hidden = { ...chain.publicClient, getTransaction: args => {
      if (args.hash === job.transactionHash) throw new TransactionNotFoundError({ hash: args.hash }); return chain.publicClient.getTransaction(args);
    } };
    assert.equal((await run({ reader: hidden })).outcome, "nonce_conflict"); assert.equal(sends, 1);
    assert.equal(await chain.publicClient.getBalance({ address: payment.claim.recipient }), 0n);
  });

  return async function afterRevocation() {
    await scenario("club review revocation cannot erase pending payout history; exact Safe receipt and accounting commit atomically", async () => {
      assert.equal((await run()).outcome, "pending"); assert.equal(sends, 1);
      await chain.testClient.setAutomine(true); await chain.testClient.mine({ blocks: 1 });
      assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash: job.transactionHash, timeout: 10000 })).status, "success");
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      const proof = await readVerifiedRewardClubPayment(chain.publicClient, payment, signedTransaction, deps.creationCode);
      assert.equal(proof.payment.safeReceivedLogIndex, proof.payment.logIndex + 1);
      const current = await read(), args = { p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId, p_job_id: job.jobId,
        p_worker_id: workerId, p_lease_token: current.leaseToken, p_payment: copy(proof.payment), p_deployment: copy(proof.checkpoint.deployment), p_observation: copy(proof.checkpoint.observation) };
      for (const mutate of [p => { p.safeReceivedLogIndex = p.logIndex; }, p => { delete p.safeReceivedLogIndex; }, p => { p.safeReceivedLogIndex = "1"; },
        p => { p.action = "pay_athlete"; }, p => { p.recipient = chain.treasury.toLowerCase(); }, p => { p.gasUsed = "9999999"; }]) {
        const p = copy(proof.payment); mutate(p); await assert.rejects(query(rpcSql("service_confirm_reward_club_payment_job", { ...args, p_payment: p })));
      }
      const before = await scalar("select count(*) from app_private.reward_campaign_observations");
      await query(`create function app_private.reward_club_confirmation_test_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic club confirmation failure';end$$;
        create trigger reward_club_confirmation_test_fail before insert on app_private.reward_club_payment_confirmations for each row execute function app_private.reward_club_confirmation_test_fail();`);
      try { assert.equal((await run()).outcome, "unavailable"); assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"), before);
        assert.equal(await scalar("select count(*) from app_private.reward_club_payment_confirmations"), 0); }
      finally { await query("drop trigger reward_club_confirmation_test_fail on app_private.reward_club_payment_confirmations; drop function app_private.reward_club_confirmation_test_fail();"); }
      // Session expiration while the exact receipt waits rolls back the write.
      let denial;
      const expiredRpc = async (name, a) => {
        if (name !== "service_reward_operator_session_call" || a.p_method !== "service_confirm_reward_club_payment_job") return rpc(name, a);
        const release = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update;
          update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(operator.sessionId)}`);
        const response = rpc(name, a); response.catch(() => {});
        try { await waiting(1); } finally { await release(); }
        const r = await response; denial = r.error?.message; return r;
      };
      assert.equal((await run({ rpc: expiredRpc })).outcome, "unavailable"); assert.equal(denial, "reward_account_session_required");
      assert.equal(await scalar("select count(*) from app_private.reward_club_payment_confirmations"), 0);
      await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(operator.sessionId)}`);
      let lost = false, confirmationError;
      const uncertain = async (name, a) => { const r = await rpc(name, a);
        if (name === "service_reward_operator_session_call" && a.p_method === "service_confirm_reward_club_payment_job") {
          confirmationError = r.error?.message ?? null; if (!r.error && !lost) { lost = true; throw Error("Synthetic lost club commit response"); }
        } return r;
      };
      assert.equal((await run({ rpc: uncertain })).outcome, "unavailable"); assert.equal(confirmationError, null); assert.equal(lost, true);
      assert.equal((await read()).state, "confirmed"); assert.equal((await run({ reader: {} })).outcome, "confirmed"); assert.equal(sends, 1);
      assert.equal(await scalar("select count(*) from app_private.reward_club_payment_confirmations"), 1);
      assert.equal(await scalar("select count(*) from app_private.reward_campaign_observations"), before + 1);
      assert.equal(await scalar(`select app_private.reward_confirmed_campaign_payments(${literal(job.campaignId)})::text`), payment.claim.amount.toString());
      assert.equal(await chain.publicClient.getBalance({ address: payment.claim.recipient }), payment.claim.amount);
      assert.equal(await chain.publicClient.getTransactionCount({ address: signer.address }), 1);
      assert.equal(proof.checkpoint.observation.accounting.nativeBalance + payment.claim.amount, payment.expected.upload.budgets[0]);
      await assert.rejects(query("update app_private.reward_club_payment_confirmations set confirmed_at=clock_timestamp()"), { code: "reward_ledger_is_immutable" });
      assert.equal(await nextRewardOperatorJob(operator, { programmeId, chainId: 31337, excludedSigners: [] }, rpc), null);
    });
    await clubPortalSystemScenarios({ harness, scenario, owner, operator, payment, deps });
  };
}
