import assert from "node:assert/strict";
import { requestRewardClubTreasury, withdrawRewardClubTreasury, readRewardClubReviewContext, recordRewardClubReview, revokeRewardClubReview } from "../dist/rewards/index.js";
import { reviewClubRewardTreasury } from "../../../apps/api/dist/features/rewards/club-treasury-review-service.js";
import { clubReviewFixture } from "../../../apps/api/test/fixtures/reward-club-review.mjs";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { organizerClubScenarios } from "./reward-organizer-club-scenarios.mjs";
const fid = n => `7c300000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export async function clubReviewScenarios({ harness, scenario, roleBefore, programmeId }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const operator = { userId: id(4), sessionId: fid(1) }, owner = { userId: id(5), sessionId: fid(2) };
  const renewed = { ...operator, sessionId: fid(3) }, profileId = fid(4), clubId = id(2000);
  const fixture = clubReviewFixture(), evidence = fixture.input.evidence, deps = { chainId: 31337, reader: fixture.chain.reader, rpc };
  const total = await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  const count = table => scalar(`select count(*) from app_private.${table}`);
  const expire = (who, expired) => query(`update auth.sessions set not_after=clock_timestamp()+interval '${expired ? "-1 second" : "1 hour"}' where id=${literal(who.sessionId)}`);
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(operator.sessionId)},${literal(operator.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(owner.sessionId)},${literal(owner.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(renewed.sessionId)},${literal(renewed.userId)},clock_timestamp()+interval '1 hour');
    insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id)
      values(${literal(profileId)},'synthetic-treasury-review-owner','Synthetic','Reviewer owner','Synthetic treasury owner',1990,'active',true,${literal(owner.userId)});
    insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id)
      select ${literal(fid(5))},${literal(clubId)},${literal(profileId)},'active',id from public.club_roles where club_id=${literal(clubId)} and is_owner;`);
  let nomination = await requestRewardClubTreasury(owner, 31337, { clubId, candidate: evidence.candidate, idempotencyKey: "club-review-nomination-01" }, rpc);
  const read = () => readRewardClubReviewContext(operator, programmeId, nomination.requestId, rpc);
  const prepare = async key => { const c = await read(); return { programmeId, requestId: nomination.requestId,
    expectedIdentityFingerprintSha256: c.identityFingerprintSha256, expectedRevision: c.latestReview?.revision ?? 0,
    evidence: structuredClone(evidence), idempotencyKey: key }; };
  const review = input => reviewClubRewardTreasury(operator, input, deps);
  const reviewArgs = input => ({ p_programme_id: programmeId, p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId,
    p_request_id: input.requestId, p_expected_identity_fingerprint: input.expectedIdentityFingerprintSha256, p_expected_revision: input.expectedRevision,
    p_evidence: input.evidence, p_idempotency_key: input.idempotencyKey });
  let firstInput, first, second;

  await scenario("club treasury review is private programme-operator work, not club ownership or a matching address", async () => {
    const c = await read(); assert.equal(c.reviewState, "unreviewed"); assert.equal(c.nomination.userId, owner.userId);
    await assert.rejects(readRewardClubReviewContext(owner, programmeId, nomination.requestId, rpc), { code: "reward_operator_permission_required" });
    await assert.rejects(readRewardClubReviewContext(operator, fid(90), nomination.requestId, rpc), { code: "reward_operator_permission_required" });
    const wrongChain = await requestRewardClubTreasury(owner, 10143, { clubId, candidate: evidence.candidate, idempotencyKey: "club-review-other-chain" }, rpc);
    await assert.rejects(readRewardClubReviewContext(operator, programmeId, wrongChain.requestId, rpc), { code: "reward_club_review_scope_required" });
    await expire(operator, true); await assert.rejects(read(), { code: "reward_account_session_required" }); await expire(operator, false);
    const foreign = await scalar(`select id from app_private.reward_club_treasury_requests where club_id<>${literal(clubId)} limit 1`);
    await assert.rejects(readRewardClubReviewContext(operator, programmeId, foreign, rpc), { code: "reward_club_review_scope_required" });
  });
  await scenario("concurrent verified-service retries preserve one immutable club review and reject changed evidence/revisions", async () => {
    firstInput = await prepare("club-review-first");
    const release = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    const pending = Promise.all([review(firstInput), review(firstInput)]); pending.catch(() => {});
    try { await waiting(2); } finally { await release(); }
    const [x, y] = await pending; assert.deepEqual(x, y); first = x;
    assert.equal(first.revision, 1); assert.equal((await read()).reviewState, "reviewed"); assert.equal(await count("reward_club_treasury_reviews"), 1);
    await assert.rejects(review({ ...firstInput, evidence: { ...evidence, authorityEvidenceRef: fid(88) } }), { code: "reward_ledger_idempotency_conflict" });
    await assert.rejects(recordRewardClubReview(operator, { ...firstInput, idempotencyKey: "stale-club-revision" }, rpc), { code: "reward_club_review_revision_changed" });
    await assert.rejects(query(`update app_private.reward_club_treasury_reviews set revision=2 where id=${literal(first.reviewId)}`), { code: "reward_ledger_is_immutable" });
    for (const patch of [{ chainId: null }, { chainId: "31337" }, { candidate: {} }, { executionHistoryEvidenceRef: false }, { extra: true },
      { reviewedBlock: { ...evidence.reviewedBlock, number: "49" } }]) {
      const body = { ...evidence, ...patch };
      assert.equal(await scalar(`select app_private.valid_reward_club_review_evidence(${literal(JSON.stringify(body))}::jsonb)`), false);
    }
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
  });
  await scenario("club review revocation is append-only and original older retries survive a later review and renewed session", async () => {
    const input = { programmeId, reviewId: first.reviewId, reason: "operator_correction" };
    const [x, y] = await Promise.all([revokeRewardClubReview(operator, input, rpc), revokeRewardClubReview(operator, input, rpc)]);
    assert.deepEqual(x, y); assert.equal((await read()).reviewState, "revoked");
    await assert.rejects(revokeRewardClubReview(operator, { ...input, reason: "authority_uncertain" }, rpc), { code: "reward_ledger_idempotency_conflict" });
    second = await review(await prepare("club-review-second")); assert.equal(second.revision, 2);
    const unavailable = { ...deps, reader: { getChainId: async () => { throw Error("Must not refresh history"); } } };
    const old = await reviewClubRewardTreasury(renewed, firstInput, unavailable);
    assert.equal(old.reviewId, first.reviewId); assert.equal(old.revision, 1); assert.ok(old.revokedAt); assert.equal(old.reviewedSessionId, operator.sessionId);
    assert.equal(await count("reward_club_treasury_reviews"), 2);
  });
  await scenario("account change-and-change-back cannot revive a review; a current explicit review is required without changing rewards", async () => {
    const before = await read(), locale = await scalar(`select locale from public.user_profiles where user_id=${literal(owner.userId)}`);
    await query(`update public.user_profiles set locale='hr' where user_id=${literal(owner.userId)};
      update public.user_profiles set locale=${literal(locale)} where user_id=${literal(owner.userId)}`);
    const after = await read(); assert.equal(after.nomination.status, "pending_review"); assert.equal(after.reviewState, "identity_changed");
    assert.notEqual(after.identityFingerprintSha256, before.identityFingerprintSha256);
    await assert.rejects(recordRewardClubReview(operator, { ...await prepare("club-identity-stale"), expectedIdentityFingerprintSha256: before.identityFingerprintSha256 }, rpc),
      { code: "reward_club_review_identity_changed" });
    second = await review(await prepare("club-identity-current")); assert.equal((await read()).reviewState, "reviewed");
  });
  await scenario("club review reads and writes recheck session expiry after real table waits and roll back rejected inserts/revocations", async () => {
    const releaseRead = await lock("lock table app_private.reward_club_treasury_reviews in access exclusive mode");
    const reading = assert.rejects(read(), { code: "reward_account_session_required" }); reading.catch(() => {});
    try { await waiting(1); await expire(operator, true); } finally { await releaseRead(); } await reading; await expire(operator, false);
    const next = await prepare("club-review-expired-insert"), before = await count("reward_club_treasury_reviews");
    const releaseWrite = await lock("lock table app_private.reward_club_treasury_reviews in share mode");
    const saving = assert.rejects(review(next), { code: "reward_account_session_required" }); saving.catch(() => {});
    try { await waiting(1); await expire(operator, true); } finally { await releaseWrite(); } await saving; await expire(operator, false);
    assert.equal(await count("reward_club_treasury_reviews"), before);
    const revocations = await count("reward_club_treasury_revocations"), unlock = await lock("lock table app_private.reward_club_treasury_revocations in share mode");
    const revoking = assert.rejects(revokeRewardClubReview(operator, { programmeId, reviewId: second.reviewId, reason: "key_control_changed" }, rpc), { code: "reward_account_session_required" }); revoking.catch(() => {});
    try { await waiting(1); await expire(operator, true); } finally { await unlock(); } await revoking; await expire(operator, false);
    assert.equal(await count("reward_club_treasury_revocations"), revocations); assert.equal((await read()).reviewState, "reviewed");
  });
  await scenario("owner identity changes during a review lock wait retain holds and do not create approval", async () => {
    const next = await prepare("club-review-owner-wait"), before = await count("reward_club_treasury_reviews");
    const unlock = await lock(`update public.athlete_profiles set claimed_by_user_id=${literal(operator.userId)} where id=${literal(profileId)}`);
    const pending = assert.rejects(recordRewardClubReview(operator, next, rpc), { code: "reward_club_review_identity_changed" }); pending.catch(() => {});
    try { await waiting(1); } finally { await unlock(); } await pending;
    assert.equal((await read()).reviewState, "identity_hold"); assert.equal(await count("reward_club_treasury_reviews"), before);
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(owner.userId)} where id=${literal(profileId)}`);
    assert.equal((await read()).reviewState, "identity_hold");
    const old = await review(firstInput); assert.equal(old.reviewId, first.reviewId); assert.ok(old.revokedAt);
    nomination = await requestRewardClubTreasury(owner, 31337, { clubId, candidate: evidence.candidate, idempotencyKey: "club-review-nomination-02" }, rpc);
    assert.equal((await read()).reviewState, "unreviewed");
  });
  await scenario("explicit nomination withdrawal while a review waits cannot create a usable destination or redistribute its award", async () => {
    const next = await prepare("club-review-withdraw-wait"), before = await count("reward_club_treasury_reviews");
    const unlock = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    const pending = assert.rejects(review(next), { code: "reward_club_review_hold" }); pending.catch(() => {});
    try { await waiting(1); await withdrawRewardClubTreasury(owner, 31337, nomination.requestId, rpc); } finally { await unlock(); } await pending;
    assert.equal((await read()).reviewState, "request_withdrawn"); assert.equal(await count("reward_club_treasury_reviews"), before);
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
    nomination = await requestRewardClubTreasury(owner, 31337, { clubId, candidate: evidence.candidate, idempotencyKey: "club-review-nomination-03" }, rpc);
  });
  await scenario("service-only invoker/RLS/immutability checks and positive review/revocation use no browser grants or committed role changes", async () => {
    const input = await prepare("club-review-service-positive"), sql = rpcSql("service_record_reward_club_review", reviewArgs(input));
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${sql} rollback;`));
    const result = (await query(`begin; alter role service_role bypassrls; set local role service_role; ${sql}
      select public.service_revoke_reward_club_review(${literal(programmeId)},${literal(operator.userId)},${literal(operator.sessionId)},
        (select id from app_private.reward_club_treasury_reviews where idempotency_key='club-review-service-positive'),'operator_correction'); rollback;`)).split("\n").map(JSON.parse);
    assert.equal(result[0].revision, 1); assert.ok(result[1].revokedAt); assert.equal(result[1].reviewId, result[0].reviewId);
    assert.equal(await scalar("select count(*) from app_private.reward_club_treasury_reviews where idempotency_key='club-review-service-positive'"), 0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    for (const name of ["reward_club_treasury_reviews", "reward_club_treasury_revocations"]) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='app_private.${name}'::regclass`), true);
      assert.equal(await scalar(`select has_table_privilege('authenticated','app_private.${name}','select')`), false);
      assert.equal(await scalar(`select has_table_privilege('service_role','app_private.${name}','update,delete')`), false);
    }
    assert.equal(await scalar("select count(*) from pg_proc where proname in ('valid_reward_club_review_evidence','reward_club_review_fingerprint','reward_club_review_context','reward_club_review_document','service_read_reward_club_review_context','service_record_reward_club_review','service_revoke_reward_club_review') and prosecdef"), 0);
  });
  await organizerClubScenarios({ harness, scenario, roleBefore, programmeId, operator, nomination, evidence, chainReader: fixture.chain.reader });
  // Join the runner's existing final operator-revocation scenario. There is no
  // need to transfer the same organization out and back solely for this check.
  const revokedInput = await prepare("club-review-operator-wait"), beforeRevocation = await count("reward_club_treasury_reviews");
  return {
    startRevocationCheck: () => assert.rejects(recordRewardClubReview(operator, revokedInput, rpc), { code: "reward_operator_permission_required" }),
    assertRevoked: async () => {
      await assert.rejects(read(), { code: "reward_operator_permission_required" });
      assert.equal(await count("reward_club_treasury_reviews"), beforeRevocation);
      assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
    },
  };
}
