import assert from "node:assert/strict";
import { requestRewardClubTreasury, readRewardClubReviewContext, revokeRewardClubReview, readRewardClubClaimContext,
  storeRewardClubClaimIntent, copyRewardLedgerDocument as copy } from "../dist/rewards/index.js";
import { reviewClubRewardTreasury } from "../../../apps/api/dist/features/rewards/club-treasury-review-service.js";
import { prepareClubRewardClaim, clubRewardClaimExpectation } from "../../../apps/api/dist/features/rewards/club-claim-service.js";
import { readVerifiedRewardClubClaim, readVerifiedRewardClubSafeDeployment, rewardCampaignAbi } from "../../rewards-chain/dist/index.js";
import { deployOriginalClubSafeFixture } from "../../rewards-chain/integration/safe-deployment-fixture.mjs";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
import { clubProofSystemScenarios } from "./reward-club-proof-system-scenarios.mjs";
import { clubClaimHttp } from "./reward-club-claim-http.mjs";
const fid = n => `7c400000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Actual scratch SQL plus the parent-owned original-Safe/Monad simulator. No
// real athlete/club identities, provider, public token or user signer is used.
export async function clubClaimSystemScenarios({ harness, scenario, chain, entries, programmeId }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const operator = { userId: id(4), sessionId: fid(1) }, owner = { userId: fid(2), sessionId: fid(3) }, clubId = id(2000);
  const roleBefore = await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
  const total = await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(${literal(owner.userId)},'synthetic-club-claim@example.invalid','authenticated','authenticated','{}','{}',now(),now());
    update public.user_profiles set status='active' where user_id=${literal(owner.userId)};
    insert into auth.sessions(id,user_id,not_after) values
      (${literal(operator.sessionId)},${literal(operator.userId)},clock_timestamp()+interval '1 hour'),
      (${literal(owner.sessionId)},${literal(owner.userId)},clock_timestamp()+interval '1 hour');
    insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id)
      values(${literal(fid(4))},'synthetic-club-claim-owner','Synthetic','Club owner','Synthetic club owner',1990,'active',true,${literal(owner.userId)});
    insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id)
      select ${literal(fid(5))},${literal(clubId)},${literal(fid(4))},'active',id from public.club_roles where club_id=${literal(clubId)} and is_owner;`);
  const created = await deployOriginalClubSafeFixture(chain);
  await chain.testClient.mine({ blocks: 96, interval: 1 });
  const original = await readVerifiedRewardClubSafeDeployment(chain.publicClient, created.provenance), safe = original.safe;
  const candidate = { safeAddress: safe.context.verifyingContract.toLowerCase(), singletonAddress: safe.singletonAddress.toLowerCase(),
    fallbackHandlerAddress: safe.fallbackHandlerAddress.toLowerCase(), owners: [...safe.owners] };
  const nomination = await requestRewardClubTreasury(owner, 31337, { clubId, candidate, idempotencyKey: "system-club-claim-treasury" }, rpc);
  const evidence = copy({ schemaVersion: 1, policy: "operator-reviewed-original-safe-v1", chainId: 31337, candidate,
    factoryAddress: original.factoryAddress.toLowerCase(), deploymentTransactionHash: original.deploymentTransactionHash,
    deploymentBlock: original.deploymentBlock, reviewedBlock: safe.finalizedBlock, initializerHash: original.initializerHash,
    authorityEvidenceRef: fid(10), controlEvidenceRef: fid(11), recoveryEvidenceRef: fid(12), executionHistoryEvidenceRef: fid(13) });
  const review = async key => {
    const context = await readRewardClubReviewContext(operator, programmeId, nomination.requestId, rpc);
    return reviewClubRewardTreasury(operator, { programmeId, requestId: nomination.requestId, evidence,
      expectedIdentityFingerprintSha256: context.identityFingerprintSha256, expectedRevision: context.latestReview?.revision ?? 0, idempotencyKey: key },
    { chainId: 31337, reader: chain.publicClient, rpc });
  };
  let approved = await review("system-club-claim-review");
  const entitlement = async entry => scalar(`select e.id from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id
    where b.campaign_id=${literal(entry.campaign.id)} and b.kind='club' and b.entity_id=${literal(clubId)}`);
  const request = async (entry, key) => ({ reviewId: approved.reviewId, entitlementId: await entitlement(entry), idempotencyKey: key });
  const deps = { chainId: 31337, rpc, reader: chain.publicClient, creationCode: chain.artifact.bytecode.object };
  const prepare = input => prepareClubRewardClaim(operator, input, deps);
  const http = clubClaimHttp({ rpc, reader: chain.publicClient, programmeId });
  const read = input => readRewardClubClaimContext(operator, input, rpc);
  const witness = async input => readVerifiedRewardClubClaim(chain.publicClient, clubRewardClaimExpectation(await read(input)), chain.artifact.bytecode.object);
  const count = () => scalar("select count(*) from app_private.reward_club_claim_intents");
  const expired = yes => query(`update auth.sessions set not_after=clock_timestamp()+interval '${yes ? "-1 second" : "1 hour"}' where id=${literal(operator.sessionId)}`);
  const sqlArgs = (r, w) => ({ p_actor_user_id: operator.userId, p_actor_session_id: operator.sessionId, p_review_id: r.reviewId,
    p_entitlement_id: r.entitlementId, p_idempotency_key: r.idempotencyKey, p_witness: copy(w), p_observed_at: new Date().toISOString() });
  let first, firstRequest, renewed;
  await scenario("club claim preparation binds an actual unpaid Safe award and concurrent retries keep one original intent without payment", async () => {
    firstRequest = await request(entries[0], "system-club-first");
    await assert.rejects(readRewardClubClaimContext(owner, firstRequest, rpc), { code: "reward_operator_permission_required" });
    const athlete = await scalar(`select e.id from app_private.reward_entitlements e join app_private.reward_beneficiaries b on b.id=e.beneficiary_id
      where b.campaign_id=${literal(entries[0].campaign.id)} and b.kind='athlete' limit 1`);
    await assert.rejects(read({ ...firstRequest, entitlementId: athlete }), { code: "reward_claim_scope_required" });
    const unlock = await lock(`select id from app_private.reward_programmes where id=${literal(programmeId)} for update`);
    const pending = Promise.all([http.prepare(operator, firstRequest), http.prepare(operator, firstRequest)]); pending.catch(() => {});
    try { await waiting(2); } finally { await unlock(); }
    const [a, b] = await pending; assert.deepEqual(a, b); assert.equal(a.state, "prepared"); first = await prepare(firstRequest);
    assert.equal(a.intentId, first.intentId); assert.equal(a.amountWei, first.claim.amount.toString());
    assert.equal(a.recipientAddress, first.claim.recipient);
    assert.deepEqual(await http.prepare(operator, firstRequest), a);
    assert.equal(first.claim.recipient.toLowerCase(), candidate.safeAddress); assert.equal(first.claim.pot, "race");
    assert.equal(await count(), 1); assert.equal(await chain.publicClient.getBalance({ address: candidate.safeAddress }), 0n);
    assert.equal((await read(firstRequest)).intent.chainWitness.treasury.executionHistoryReviewRequired, true);
  });
  await scenario("revoked club reviews retain historical retries but cannot prepare new claims; a new review cannot overlap the old nonce window", async () => {
    await revokeRewardClubReview(operator, { programmeId, reviewId: approved.reviewId, reason: "operator_correction" }, rpc);
    assert.deepEqual(await prepareClubRewardClaim(operator, firstRequest, { ...deps, reader: () => { throw Error("History must not contact RPC"); } }), first);
    await assert.rejects(prepare({ ...firstRequest, idempotencyKey: "system-club-revoked" }), { code: "reward_claim_readiness_required" });
    approved = await review("system-club-second-review");
    await assert.rejects(prepare(await request(entries[0], "system-club-overlap")), { code: "reward_claim_already_prepared" });
    const league = await prepare(await request(entries.at(-1), "system-club-league"));
    assert.equal(league.claim.pot, "league"); assert.notEqual(league.claim.entitlementId, first.claim.entitlementId); assert.equal(await count(), 2);
  });
  await scenario("club SQL witness rejects altered treasury, package, nonce and review anchors without reserving another claim", async () => {
    const r = await request(entries[1], "system-club-invalid"), w = copy(await witness(r));
    for (const mutate of [x => { x.treasury.safeAddress = `0x${"ab".repeat(20)}`; }, x => { x.treasury.owners.reverse(); },
      x => { x.treasury.reviewedBlock.hash = `0x${"ab".repeat(32)}`; }, x => { x.treasury.executionHistoryReviewRequired = false; },
      x => { x.treasury.executionNonce = null; }, x => { x.treasury.extra = true; }, x => { x.award.beneficiaryKind = 0; },
      x => { x.award.amount = "1"; }, x => { x.observation.accounting.allocationDigest = `0x${"ab".repeat(32)}`; }]) {
      const changed = structuredClone(w); mutate(changed);
      await assert.rejects(query(rpcSql("service_prepare_reward_club_claim", sqlArgs(r, changed))), { code: "invalid_reward_claim_witness" });
    }
    await assert.rejects(storeRewardClubClaimIntent(operator, { ...r, witness: w, observedAt: "2020-01-01T00:00:00Z" }, rpc), { code: "reward_claim_observation_stale" });
    assert.equal(await count(), 2);
  });
  await scenario("club claim reads and insertions recheck real operator-session expiry after table waits and roll back", async () => {
    let unlock = await lock("lock table app_private.reward_club_claim_intents in access exclusive mode");
    let pending = assert.rejects(read(firstRequest), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await expired(true); } finally { await unlock(); } await pending; await expired(false);
    const r = await request(entries[1], "system-club-expired-insert"), w = await witness(r);
    unlock = await lock("lock table app_private.reward_club_claim_intents in share mode");
    pending = assert.rejects(storeRewardClubClaimIntent(operator, { ...r, witness: w, observedAt: new Date().toISOString() }, rpc), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await expired(true); } finally { await unlock(); } await pending; await expired(false);
    assert.equal(await count(), 2);
  });
  await scenario("changed club-owner identity while preparation waits creates a hold and preserves all award amounts", async () => {
    const r = await request(entries[1], "system-club-identity-wait"), w = await witness(r);
    const unlock = await lock(`update public.user_profiles set locale=case when locale='hr' then 'en' else 'hr' end where user_id=${literal(owner.userId)}`);
    const pending = assert.rejects(storeRewardClubClaimIntent(operator, { ...r, witness: w, observedAt: new Date().toISOString() }, rpc), { code: "reward_claim_readiness_required" }); pending.catch(() => {});
    try { await waiting(1); } finally { await unlock(); } await pending;
    assert.equal((await read(r)).reviewContext.reviewState, "identity_changed"); assert.equal(await count(), 2);
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
    approved = await review("system-club-current-identity");
  });
  await scenario("club claim persistence stays service-only, immutable and source-bound", async () => {
    const r = await request(entries[1], "system-club-source-hold"), w = await witness(r), statement = rpcSql("service_prepare_reward_club_claim", sqlArgs(r, w));
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${statement} rollback;`));
    const mapping = await scalar(`select id from public.league_round_race_mappings where league_round_event_id=${literal(entries[1].campaign.scopeKey)} limit 1`);
    await assert.rejects(query(`begin; update public.league_round_race_mappings set current_result_publication_id=null where id=${literal(mapping)}; ${statement} rollback;`),
      { code: "reward_mapping_source_not_ready" });
    const saved = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${statement} rollback;`));
    assert.equal(saved.intent.treasuryReviewId, approved.reviewId); assert.equal(await count(), 2);
    await assert.rejects(query(`update app_private.reward_club_claim_intents set nonce=99 where id=${literal(first.intentId)}`), { code: "reward_ledger_is_immutable" });
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='app_private.reward_club_claim_intents'::regclass"), true);
    assert.equal(await scalar("select has_table_privilege('authenticated','app_private.reward_club_claim_intents','select')"), false);
    assert.equal(await scalar("select has_table_privilege('service_role','app_private.reward_club_claim_intents','update,delete')"), false);
    assert.equal(await scalar("select count(*) from pg_proc where proname in('service_read_reward_club_claim_context','service_prepare_reward_club_claim','require_reward_club_claim_witness','reward_club_claim_document') and prosecdef"), 0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  });
  await scenario("finalized club authorization revocation permits one fresh window without another award or payment", async () => {
    const hash = await chain.operatorClient.writeContract({ address: first.context.verifyingContract, abi: rewardCampaignAbi,
      functionName: "revokeAuthorization", args: [first.claim.entitlementId] });
    assert.equal((await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 10000 })).status, "success");
    await chain.testClient.mine({ blocks: 96, interval: 1 });
    const requests = [await request(entries[0], "system-club-renew-a"), await request(entries[0], "system-club-renew-b")];
    const results = await Promise.allSettled(requests.map(prepare));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.find(r => r.status === "rejected").reason.code, "reward_claim_already_prepared");
    renewed = results.find(r => r.status === "fulfilled").value;
    assert.equal(renewed.claim.nonce, 1n); assert.equal(renewed.claim.amount, first.claim.amount); assert.equal(await count(), 3);
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
    assert.equal(await chain.publicClient.getBalance({ address: candidate.safeAddress }), 0n);
  });
  await clubProofSystemScenarios({ harness, scenario, chain, entries, programmeId, operator, owner, prepared: renewed, prepare, request, deps });
}
