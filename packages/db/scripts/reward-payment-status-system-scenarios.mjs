import assert from "node:assert/strict";
import { getAthleteRewardPaymentStatus } from "../../../apps/api/dist/features/rewards/athlete-payment-status-service.js";
import { dispatchAthleteRewardRoutes } from "../../../apps/api/dist/routes/rewards/athlete.js";
import { applyPrivateSessionHeaders } from "../../../apps/api/dist/browser-session.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";

// Actual owned SQL/chain receipts; HTTP identity is synthetic, not hosted Auth.
export async function paymentStatusSystemScenarios({ harness, scenario, chain, recipient, identity, deps, job }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const args = { p_user_id: recipient.userId, p_session_id: recipient.sessionId, p_chain_id: 31337, p_intent_id: job.claimIntentId };
  const read = (who = recipient, intentId = job.claimIntentId, options = deps) => getAthleteRewardPaymentStatus(who, intentId, options);
  const sql = (override = {}) => rpcSql("service_read_reward_athlete_payment_status", { ...args, ...override });
  await scenario("athlete payment HTTP read projects the exact committed finalized receipt without operator data or another send", async () => {
    const before = await scalar("select jsonb_build_array((select count(*) from app_private.reward_athlete_payment_jobs),(select count(*) from app_private.reward_athlete_payment_confirmations),(select count(*) from app_private.reward_relayer_nonce_slots),(select count(*) from app_private.reward_athlete_payment_job_events))");
    const value = await read(); assert.equal(value.status, "confirmed"); assert.equal(value.receipt.transactionHash, job.transactionHash);
    const receipt = await chain.publicClient.getTransactionReceipt({ hash: job.transactionHash });
    assert.equal(value.receipt.blockNumber, receipt.blockNumber.toString()); assert.equal(value.receipt.blockHash, receipt.blockHash);
    assert.equal(value.receipt.contractAddress, receipt.to.toLowerCase()); assert.equal(receipt.status, "success");
    assert(BigInt(value.receipt.finalizedBlock.number) >= receipt.blockNumber);
    assert.doesNotMatch(JSON.stringify(value), /signature|signedTransaction|userId|sessionId|lease|relayer|authorizationNonce|witness|balance|accounting|idempotencyKey/i);
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
    assert.equal(await dispatchAthleteRewardRoutes({ method: "GET", headers: {} }, res,
      new URL(`/api/v1/athlete/rewards/claims/${job.claimIntentId}/payment`, deps.origin), {
        config: () => deps, requireIdentity: async () => recipient, rpc, applyPrivateSessionHeaders,
        readJsonBody: async () => { throw new Error("unexpected body read"); },
        sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (r, status, code) => { throw new Error(`${status}:${code}`); },
        claimReader: new Proxy({}, { get() { throw new Error("unexpected chain IO"); } }),
      }), true);
    assert.equal(res.headers["Cache-Control"], "private, no-store"); assert.deepEqual(res.body.data, value);
    assert.deepEqual(await read(), value);
    assert.deepEqual(await scalar("select jsonb_build_array((select count(*) from app_private.reward_athlete_payment_jobs),(select count(*) from app_private.reward_athlete_payment_confirmations),(select count(*) from app_private.reward_relayer_nonce_slots),(select count(*) from app_private.reward_athlete_payment_job_events))"), before);
  });
  await scenario("receipt history stays with the original claim recipient through owner changes, renewal, another network and new sessions", async () => {
    const value = await read();
    await assert.rejects(read(identity), { code: "reward_payment_status_not_found" });
    await assert.rejects(read(recipient, id(99999)), { code: "reward_payment_status_not_found" });
    await assert.rejects(read(recipient, job.claimIntentId, { ...deps, chainId: 10143 }), { code: "reward_payment_status_not_found" });
    await assert.rejects(read({ ...recipient, sessionId: identity.sessionId }), { code: "reward_account_session_required" });
    const changedOwnerRpc = async (name, parameters) => {
      assert.equal(name, "service_read_reward_athlete_payment_status");
      return { data: JSON.parse(await query(`begin; alter role service_role bypassrls;
        update public.athlete_profiles set claimed_by_user_id=${literal(identity.userId)} where id=${literal(id(1000))};
        set local role service_role; ${rpcSql(name, parameters)} rollback;`)), error: null };
    };
    assert.deepEqual(await read(recipient, job.claimIntentId, { ...deps, rpc: changedOwnerRpc }), value);
    await assert.rejects(query(`begin; alter role service_role bypassrls;
      update public.athlete_profiles set claimed_by_user_id=${literal(identity.userId)} where id=${literal(id(1000))};
      set local role service_role; ${sql({ p_user_id: identity.userId, p_session_id: identity.sessionId })} rollback;`),
    { code: "reward_payment_status_not_found" });
    // Entire owner/updated_at write rolls back, preserving later readiness tests.
    const old = await scalar(`select id from app_private.reward_athlete_claim_intents where entitlement_id=${literal(job.entitlementId)} and id<>${literal(job.claimIntentId)} order by id limit 1`);
    assert(old); const renewed = await read(recipient, old);
    assert.equal(renewed.entitlementId, value.entitlementId); assert.equal(renewed.status, "no_confirmation"); assert.equal(renewed.receipt, null,
      "a receipt is not copied across renewed intents and cannot count as another reward");
    const otherIntent = id(99887);
    const other = JSON.parse(await query(`begin; alter role service_role bypassrls;
      insert into app_private.reward_athlete_claim_intents(id,campaign_id,entitlement_id,readiness_review_id,upload_id,recipient_user_id,
        recipient_address,nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id,prepared_at,idempotency_key,chain_witness)
      select ${literal(otherIntent)},campaign_id,entitlement_id,readiness_review_id,upload_id,${literal(identity.userId)},
        recipient_address,nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id,prepared_at,'payment-history-other-owner',chain_witness
        from app_private.reward_athlete_claim_intents where id=${literal(job.claimIntentId)};
      set local role service_role; ${sql({ p_user_id: identity.userId, p_session_id: identity.sessionId, p_intent_id: otherIntent })} rollback;`));
    assert.equal(other.status, "no_confirmation"); assert.equal(other.confirmation, null, "same entitlement must not expose the prior owner's receipt");
    const nextSession = id(99888);
    await query(`insert into auth.sessions(id,user_id,not_after) values(${literal(nextSession)},${literal(recipient.userId)},clock_timestamp()+interval '1 hour')`);
    try { assert.deepEqual(await read({ userId: recipient.userId, sessionId: nextSession }), value); }
    finally { await query(`delete from auth.sessions where id=${literal(nextSession)}`); }
    await assert.rejects(read({ userId: recipient.userId, sessionId: nextSession }), { code: "reward_account_session_required" });
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), false);
  });
  await scenario("athlete receipt read rejects a session revoked during a real SQL table-lock wait", async () => {
    const release = await lock(`lock table app_private.reward_athlete_payment_confirmations in access exclusive mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(recipient.sessionId)}`);
    const pending = assert.rejects(read(), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); } finally { await release(); }
    try { await pending; }
    finally { await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(recipient.sessionId)}`); }
    assert.equal((await read()).status, "confirmed");
  });
}
