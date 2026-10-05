import assert from "node:assert/strict";
import { getAthleteRewardClaims } from "../../../apps/api/dist/features/rewards/athlete-claim-history-service.js";
import { literal } from "./reward-integration-fixture.mjs";

// Only the parent-owned disposable database calls this. Pagination fixtures are
// transaction-local history rows, never signed/executable intents or real data.
export async function claimHistorySystemScenarios({ harness, scenario, recipient, identity, profile, first, config }) {
  const { query, scalar, rpc, lock, waiting } = harness;
  const read = (actor = recipient, after = null, chainId = 31337) => getAthleteRewardClaims(actor, after, { ...config, chainId, rpc });
  const call = (actor, session, after = "null") => `public.service_list_reward_athlete_claims(${literal(actor)}::uuid,${literal(session)}::uuid,31337,${after})`;
  await scenario("athlete claim discovery is original-recipient-only, minimal, network-scoped and reloadable after ownership changes", async () => {
    const page = await read(); assert.equal(page.items.length, 1); const row = page.items[0];
    assert.equal(row.intentId, first.intentId); assert.equal(row.amountWei, first.claim.amount.toString());
    assert.equal(row.recipientAddress, first.claim.recipient.toLowerCase()); assert.equal(row.recipientConsentRecordedAt, null);
    assert.equal(row.operatorApprovalRecordedAt, null); assert.equal(page.nextCursor, null);
    assert.doesNotMatch(JSON.stringify(page), /signature|reviewContext|dateOfBirth|userId|sessionId|chainWitness|idempotencyKey|paid|claimable|balance/i);
    assert.deepEqual(await read(identity), { items: [], nextCursor: null }, "operator cannot list another user's history");
    assert.deepEqual(await read(recipient, null, 10143), { items: [], nextCursor: null });
    assert.deepEqual(await read(recipient, first.intentId), { items: [], nextCursor: null });
    await assert.rejects(read({ ...recipient, sessionId: identity.sessionId }), { code: "reward_account_session_required" });
    // Roll back the entire profile change, including its updated_at trigger.
    // Restoring only the owner would intentionally invalidate later readiness
    // fingerprints and would pollute the independent claim-write scenarios.
    const changedOwner = JSON.parse(await query(`begin; alter role service_role bypassrls;
      update public.athlete_profiles set claimed_by_user_id=${literal(identity.userId)} where id=${literal(profile)};
      set local role service_role;
      select jsonb_build_object('original',${call(recipient.userId, recipient.sessionId)},'newOwner',${call(identity.userId, identity.sessionId)});
      rollback;`));
    assert.deepEqual(changedOwner.original, page, "original user keeps safe own historical metadata, not new authority");
    assert.deepEqual(changedOwner.newOwner, { items: [], nextCursor: null }, "new profile owner does not inherit private claim history");
    const nextSession = "7a000000-0000-4000-8000-000000009999";
    await query(`insert into auth.sessions(id,user_id,not_after) values(${literal(nextSession)},${literal(recipient.userId)},clock_timestamp()+interval '1 hour')`);
    try { assert.deepEqual(await read({ userId: recipient.userId, sessionId: nextSession }), page); }
    finally { await query(`delete from auth.sessions where id=${literal(nextSession)}`); }
    await assert.rejects(read({ userId: recipient.userId, sessionId: nextSession }), { code: "reward_account_session_required" });
    const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
    const pages = JSON.parse(await query(`begin; alter role service_role bypassrls;
      insert into app_private.reward_athlete_claim_intents(id,campaign_id,entitlement_id,readiness_review_id,upload_id,
        recipient_user_id,recipient_address,nonce,issued_at,expires_at,prepared_by_user_id,prepared_session_id,prepared_at,idempotency_key,chain_witness)
      select gen_random_uuid(),i.campaign_id,i.entitlement_id,i.readiness_review_id,i.upload_id,
        i.recipient_user_id,i.recipient_address,i.nonce,i.issued_at,i.expires_at,i.prepared_by_user_id,i.prepared_session_id,i.prepared_at,
        'history-pagination-only-'||n::text,i.chain_witness
      from app_private.reward_athlete_claim_intents i cross join generate_series(1,51) n where i.id=${literal(first.intentId)};
      set local role service_role;
      with first_page as materialized(select ${call(recipient.userId, recipient.sessionId)} body)
      select jsonb_build_object('first',body,'second',${call(recipient.userId, recipient.sessionId, "(body->>'nextCursor')::uuid")}) from first_page;
      rollback;`));
    assert.equal(pages.first.items.length, 50); assert.equal(pages.second.items.length, 2);
    assert.equal(pages.first.nextCursor, pages.first.items.at(-1).intentId); assert.equal(pages.second.nextCursor, null);
    const ids = [...pages.first.items, ...pages.second.items].map(r => r.intentId);
    assert.deepEqual(ids, [...new Set(ids)].sort()); assert(ids.includes(first.intentId));
    assert.equal(await scalar("select count(*) from app_private.reward_athlete_claim_intents"), 1, "all extra history fixtures rolled back");
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  });
  await scenario("claim history rejects a session revoked while its actual SQL read waits", async () => {
    const release = await lock(`lock table app_private.reward_athlete_claim_intents in access exclusive mode;
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(recipient.sessionId)}`);
    const pending = assert.rejects(read(), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); } finally { await release(); }
    try { await pending; }
    finally { await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${literal(recipient.sessionId)}`); }
    assert.equal((await read()).items[0].intentId, first.intentId);
  });
}
