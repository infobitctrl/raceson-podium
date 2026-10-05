import assert from "node:assert/strict";
import { getClubRewardAwards, getClubRewardClaims, getClubRewardPaymentStatus } from "../../../apps/api/dist/features/rewards/club-portal-service.js";
import { dispatchClubRewardRoutes } from "../../../apps/api/dist/routes/rewards/clubs.js";
import { applyPrivateSessionHeaders } from "../../../apps/api/dist/browser-session.js";
import { literal } from "./reward-integration-fixture.mjs";

export async function clubPortalSystemScenarios({ harness, scenario, owner, operator, payment, deps }) {
  const { rpc, query, scalar, lock, waiting, rpcSql } = harness, options = { ...deps, origin: "http://127.0.0.1:3101" };
  const clubId = await scalar(`select club_id from app_private.reward_club_claim_intents where id=${literal(payment.claimIntentId)}`);
  const args = { p_user_id: owner.userId, p_session_id: owner.sessionId, p_chain_id: 31337, p_after_id: null };
  const total = await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  const claimCount = await scalar("select count(*) from app_private.reward_club_claim_intents");
  const paymentCount = await scalar("select count(*) from app_private.reward_club_payment_confirmations");
  await scenario("club portal shows all reserved race/league shares and original-nominee claims with exact confirmed Safe receipt", async () => {
    const awards = await getClubRewardAwards(owner, clubId, null, options), history = await getClubRewardClaims(owner, null, options);
    assert.equal(awards.items.length, 6); assert.ok(awards.items.some(a => a.pot === "league")); assert.equal(awards.nextCursor, null);
    assert.equal(awards.items.reduce((n, a) => n + BigInt(a.amountWei), 0n).toString(), await scalar(`select sum(e.amount_wei)::text from app_private.reward_entitlements e
      join app_private.reward_beneficiaries b on b.id=e.beneficiary_id where b.kind='club' and b.entity_id=${literal(clubId)}`));
    assert.equal(history.items.length, claimCount); assert.ok(history.items.some(c => c.pot === "league"));
    assert.deepEqual(await getClubRewardClaims(operator, null, options), { items: [], nextCursor: null });
    await assert.rejects(getClubRewardPaymentStatus(operator, payment.claimIntentId, options), { code: "reward_payment_status_not_found" });
    const confirmed = await getClubRewardPaymentStatus(owner, payment.claimIntentId, options);
    assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.receipt.safeReceivedLogIndex, confirmed.receipt.logIndex + 1);
    assert.equal(confirmed.claim.amountWei, payment.claim.amount.toString());
    assert.doesNotMatch(JSON.stringify({ awards, history, confirmed }), /signedTransaction|signature|userId|sessionId|witness|lease|relayer|idempotency|authorizationNonce/i);
    const sameAward = history.items.find(i => i.entitlementId === confirmed.claim.entitlementId && i.intentId !== confirmed.claim.intentId);
    assert.ok(sameAward); assert.equal((await getClubRewardPaymentStatus(owner, sameAward.intentId, options)).status, "no_confirmation");
    const renewed = { ...owner, sessionId: "7c600000-0000-4000-8000-000000000001" };
    await query(`insert into auth.sessions(id,user_id,not_after) values(${literal(renewed.sessionId)},${literal(owner.userId)},clock_timestamp()+interval '1 hour')`);
    assert.deepEqual(await getClubRewardClaims(renewed, null, options), history);
    assert.deepEqual(await getClubRewardClaims(owner, null, { ...options, chainId: 10143 }), { items: [], nextCursor: null });
  });
  await scenario("club award authority and private claim history stay separate after ownership loss; browser roles cannot read the RPCs", async () => {
    // A transaction-local profile reassignment removes this account's ownership
    // without deleting the protected sole club-owner membership. Rollback keeps
    // the fixture and original nominee intact; no production transfer is run.
    const lostOwner = `update public.athlete_profiles set claimed_by_user_id=${literal(operator.userId)}
      where claimed_by_user_id=${literal(owner.userId)} and id in
        (select athlete_profile_id from public.club_memberships where club_id=${literal(clubId)})`;
    await assert.rejects(query(`begin; ${lostOwner}; ${rpcSql("service_list_reward_club_awards", { ...args, p_club_id: clubId })} rollback;`), { code: "reward_club_owner_required" });
    const history = JSON.parse(await query(`begin; ${lostOwner}; ${rpcSql("service_list_reward_club_claims", args)} rollback;`));
    assert.equal(history.items.length, claimCount);
    for (const [name, a] of [["service_list_reward_club_awards", { ...args, p_club_id: clubId }], ["service_list_reward_club_claims", args],
      ["service_read_reward_club_payment_status", { p_user_id: owner.userId, p_session_id: owner.sessionId, p_chain_id: 31337, p_intent_id: payment.claimIntentId }]]) {
      for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${rpcSql(name, a)} rollback;`));
    }
    assert.equal(await scalar("select count(*) from pg_proc where proname in('service_list_reward_club_awards','service_list_reward_club_claims','service_read_reward_club_payment_status','reward_club_claim_history_item') and prosecdef"), 0);
  });
  await scenario("club history uses bounded UUID pagination without creating durable extra claims", async () => {
    const insert = `insert into app_private.reward_club_claim_intents
      (id,campaign_id,entitlement_id,treasury_review_id,upload_id,recipient_user_id,club_id,recipient_address,nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id,prepared_at,idempotency_key,chain_witness)
      select ('ffffffff-ffff-4000-8000-'||lpad(n::text,12,'0'))::uuid,campaign_id,entitlement_id,treasury_review_id,upload_id,recipient_user_id,club_id,recipient_address,
        nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id,prepared_at,'portal-pagination-'||n::text,chain_witness
      from app_private.reward_club_claim_intents cross join generate_series(1,26) n where id=${literal(payment.claimIntentId)}`;
    const read = after => query(`begin; ${insert}; ${rpcSql("service_list_reward_club_claims", { ...args, p_after_id: after })} rollback;`).then(JSON.parse);
    const first = await read(null); assert.equal(first.items.length, 25); assert.equal(first.nextCursor, first.items.at(-1).intentId);
    const second = await read(first.nextCursor); assert.equal(second.items.length, claimCount + 1); assert.equal(second.nextCursor, null);
    assert.ok(second.items.every(i => i.intentId > first.nextCursor)); assert.equal(await scalar("select count(*) from app_private.reward_club_claim_intents"), claimCount);
  });
  await scenario("club portal reads recheck actual session expiry after relation waits and HTTP remains read-only", async () => {
    for (const [table, read] of [["reward_entitlements", () => getClubRewardAwards(owner, clubId, null, options)],
      ["reward_club_claim_intents", () => getClubRewardClaims(owner, null, options)],
      ["reward_club_payment_confirmations", () => getClubRewardPaymentStatus(owner, payment.claimIntentId, options)]]) {
      const release = await lock(`lock table app_private.${table} in access exclusive mode`);
      const pending = assert.rejects(read(), { code: "reward_account_session_required" }); pending.catch(() => {});
      try { await waiting(1); await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(owner.sessionId)}`); }
      finally { await release(); }
      await pending; await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(owner.sessionId)}`);
    }
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = JSON.parse(v); } };
    assert.equal(await dispatchClubRewardRoutes({ method: "GET", headers: {} }, res,
      new URL(`/api/v1/athlete/rewards/club-claims/${payment.claimIntentId}/payment`, options.origin), {
        config: () => options, requireIdentity: async () => owner, rpc, applyPrivateSessionHeaders,
        readJsonBody: async () => assert.fail("read must not consume a body"),
        sendSuccess: (r, data) => r.end(JSON.stringify({ data })), sendError: (_r, _status, code) => assert.fail(code),
      }), true);
    assert.equal(res.body.data.status, "confirmed"); assert.equal(res.headers["Cache-Control"], "private, no-store");
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
    assert.equal(await scalar("select count(*) from app_private.reward_club_claim_intents"), claimCount);
    assert.equal(await scalar("select count(*) from app_private.reward_club_payment_confirmations"), paymentCount);
  });
}
