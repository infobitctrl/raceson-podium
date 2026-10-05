import assert from "node:assert/strict";
import { toHex } from "viem";
import { requestRewardClubTreasury, readRewardClubTreasury, listRewardClubTreasuries, withdrawRewardClubTreasury, listRewardOwnedClubs } from "../dist/rewards/index.js";
import { nominateClubRewardTreasury } from "../../../apps/api/dist/features/rewards/club-treasury-service.js";
import { listRewardClubAllocationsV3 } from "../dist/rewards/index.js";
import { rewardId as id } from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import { literal } from "./reward-integration-fixture.mjs";
const fid = n => `7c100000-0000-4000-8000-${String(n).padStart(12, "0")}`, a = n => toHex(BigInt(n), { size: 20 });

export async function clubTreasuryScenarios({ harness, scenario, roleBefore }) {
  const { query, scalar, rpc, rpcSql, lock, waiting } = harness;
  const owner = { userId: id(4), sessionId: fid(1) }, other = { userId: id(5), sessionId: fid(2) }, renewed = { ...owner, sessionId: fid(3) };
  const clubId = fid(10), profileId = fid(11), otherProfile = fid(12), membershipId = fid(13);
  const candidate = { safeAddress: a(10), singletonAddress: a(11), fallbackHandlerAddress: a(12), owners: [a(20), a(21), a(22)] };
  const input = { clubId, candidate, idempotencyKey: "club-sql-nomination" }, config = { chainId: 31337, origin: "http://127.0.0.1:3101", rpc };
  const read = (who, r) => readRewardClubTreasury(who, 31337, r.requestId, rpc);
  const withdraw = (who, r) => withdrawRewardClubTreasury(who, 31337, r.requestId, rpc);
  const nominate = (who, key = input.idempotencyKey) => requestRewardClubTreasury(who, 31337, { ...input, idempotencyKey: key }, rpc);
  const session = (who, expired) => query(`update auth.sessions set not_after=clock_timestamp()+interval '${expired ? "-1 second" : "1 hour"}' where id=${literal(who.sessionId)}`);
  const total = await scalar("select sum(amount_wei)::text from app_private.reward_entitlements");
  let first, successor, current;
  // Synthetic identities and unverified address tuples only; never a chain
  // observation, real club role grant or recipient-control claim.
  await query(`insert into auth.sessions(id,user_id,not_after) values
    (${literal(owner.sessionId)},${literal(owner.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(other.sessionId)},${literal(other.userId)},clock_timestamp()+interval '1 hour'),
    (${literal(renewed.sessionId)},${literal(renewed.userId)},clock_timestamp()+interval '1 hour');
    insert into public.clubs(id,slug,name,status) values(${literal(clubId)},'synthetic-club-treasury','Synthetic treasury club','active');
    insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id) values
    (${literal(profileId)},'synthetic-club-owner','Synthetic','Club owner','Synthetic Club owner',1990,'active',true,${literal(owner.userId)}),
    (${literal(otherProfile)},'synthetic-club-admin','Synthetic','Club admin','Synthetic Club admin',1990,'active',true,${literal(other.userId)});
    insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id)
      select ${literal(fid(14))},${literal(clubId)},${literal(otherProfile)},'active',id from public.club_roles where club_id=${literal(clubId)} and role_key='administrator';`);

  await scenario("club treasury nominations require actual active club ownership, not organization or admin roles; concurrent retries preserve one immutable candidate", async () => {
    await assert.rejects(nominate(owner), { code: "reward_club_owner_required" });
    await assert.rejects(nominate(other), { code: "reward_club_owner_required" });
    await assert.rejects(requestRewardClubTreasury(owner, 31337, { ...input, clubId: id(2000) }, rpc), { code: "reward_club_owner_required" });
    await query(`insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id)
      select ${literal(membershipId)},${literal(clubId)},${literal(profileId)},'active',id from public.club_roles where club_id=${literal(clubId)} and is_owner;`);
    const release = await lock(`select pg_advisory_xact_lock(hashtextextended(${literal(`reward-club-treasury:${clubId}:31337`)},0))`);
    const pending = Promise.all([nominate(owner), nominate(owner)]); pending.catch(() => {});
    try { await waiting(2); } finally { await release(); }
    const [x, y] = await pending; assert.deepEqual(x, y); first = x; assert.equal(x.status, "pending_review");
    const service = await nominateClubRewardTreasury(owner, { clubId, ...candidate, idempotencyKey: input.idempotencyKey }, config);
    assert.equal(service.requestId, first.requestId); assert.equal(service.status, "pending_review");
    assert.doesNotMatch(JSON.stringify(service), /userId|sessionId|ownerIdentity|idempotencyKey|signature|verified/);
    await assert.rejects(nominate(owner, "another-current-candidate"), { code: "reward_club_treasury_withdraw_first" });
    await assert.rejects(requestRewardClubTreasury(owner, 31337, { ...input, candidate: { ...candidate, safeAddress: a(30) } }, rpc), { code: "reward_ledger_idempotency_conflict" });
    await assert.rejects(query(`update app_private.reward_club_treasury_requests set club_id=${literal(id(2000))} where id=${literal(first.requestId)}`), { code: "reward_ledger_is_immutable" });
    assert.equal(await scalar("select count(*) from app_private.reward_club_treasury_requests"), 1);
  });

  await scenario("treasury identity holds prevent automatic transfer or revival, and old owners retain only their own recoverable history", async () => {
    await assert.rejects(read(other, first), { code: "reward_club_treasury_not_found" });
    await assert.rejects(withdraw(other, first), { code: "reward_club_treasury_not_found" });
    await assert.rejects(readRewardClubTreasury(owner, 10143, first.requestId, rpc), { code: "reward_club_treasury_not_found" });
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profileId)}`);
    assert.equal((await read(owner, first)).status, "identity_hold");
    assert.deepEqual(await listRewardClubTreasuries(other, 31337, null, rpc), { items: [], nextCursor: null });
    successor = await nominate(other, "successor-club-candidate"); assert.equal(successor.status, "pending_review");
    await session(owner, true);
    await assert.rejects(read(owner, first), { code: "reward_account_session_required" });
    assert.equal((await nominate(renewed)).status, "identity_hold");
    const [x, y] = await Promise.all([withdraw(renewed, first), withdraw(renewed, first)]); assert.deepEqual(x, y); assert.equal(x.status, "withdrawn");
    await session(owner, false);
    assert.equal((await nominate(owner)).status, "withdrawn");
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(owner.userId)} where id=${literal(profileId)}`);
    assert.equal((await read(other, successor)).status, "identity_hold");
    assert.equal((await nominate(owner)).status, "withdrawn");
    current = await nominate(owner, "current-owner-new-review"); assert.equal(current.status, "pending_review");
    await query(`update public.athlete_profiles set display_name='Synthetic changed owner profile' where id=${literal(profileId)}`);
    assert.equal((await read(owner, current)).status, "identity_hold", "Even a later identity-version change cannot preserve ready-looking history");
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
  });

  await scenario("nomination rechecks ownership after actual row locks and rolls back INSERT when the session expires during a table wait", async () => {
    const release = await lock(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profileId)}`);
    const pending = assert.rejects(nominate(owner, "owner-changed-while-waiting"), { code: "reward_club_owner_required" }); pending.catch(() => {});
    try { await waiting(1); } finally { await release(); } await pending;
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(owner.userId)} where id=${literal(profileId)}`);
    const before = await scalar("select count(*) from app_private.reward_club_treasury_requests");
    const unlock = await lock("lock table app_private.reward_club_treasury_requests in share mode");
    const saving = assert.rejects(nominate(owner, "session-expires-at-insert"), { code: "reward_account_session_required" }); saving.catch(() => {});
    try { await waiting(1); await session(owner, true); } finally { await unlock(); } await saving;
    assert.equal(await scalar("select count(*) from app_private.reward_club_treasury_requests"), before);
    await session(owner, false);
  });

  await scenario("treasury reads/listing and withdrawal recheck live sessions after actual table locks without leaking history or retaining an unauthorized write", async () => {
    const release = await lock("lock table app_private.reward_club_treasury_requests in access exclusive mode");
    const reads = [read(owner, current), listRewardClubTreasuries(owner, 31337, null, rpc)].map(p => assert.rejects(p, { code: "reward_account_session_required" }));
    reads.forEach(p => p.catch(() => {}));
    try { await waiting(2); await session(owner, true); } finally { await release(); } await Promise.all(reads); await session(owner, false);
    const unlock = await lock("lock table app_private.reward_club_treasury_withdrawals in share mode");
    const saving = assert.rejects(withdraw(other, successor), { code: "reward_account_session_required" }); saving.catch(() => {});
    try { await waiting(1); await session(other, true); } finally { await unlock(); } await saving;
    assert.equal(await scalar(`select count(*) from app_private.reward_club_treasury_withdrawals where request_id=${literal(successor.requestId)}`), 0);
    await session(other, false); assert.equal((await withdraw(other, successor)).status, "withdrawn");
    await assert.rejects(query(`delete from app_private.reward_club_treasury_withdrawals where request_id=${literal(successor.requestId)}`), { code: "reward_ledger_is_immutable" });
  });

  await scenario("club treasury history traverses the actual 25/26 SQL page boundary with exact account and network scope", async () => {
    // Test-only immutable historical rows with explicit withdrawals, not 26
    // active nominations or a claimed ability to bypass the service workflow.
    await query(`insert into app_private.reward_club_treasury_requests(id,user_id,session_id,club_id,chain_id,candidate,owner_identity,idempotency_key)
      select ('7c100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,user_id,session_id,club_id,chain_id,candidate,owner_identity,'synthetic-history-'||n::text
      from app_private.reward_club_treasury_requests cross join generate_series(100,125) n where id=${literal(first.requestId)};
      insert into app_private.reward_club_treasury_withdrawals(request_id,session_id)
      select id,session_id from app_private.reward_club_treasury_requests where idempotency_key like 'synthetic-history-%';`);
    const firstPage = await listRewardClubTreasuries(renewed, 31337, null, rpc); assert.equal(firstPage.items.length, 25); assert.ok(firstPage.nextCursor);
    const lastPage = await listRewardClubTreasuries(renewed, 31337, firstPage.nextCursor, rpc); assert.equal(lastPage.items.length, 3); assert.equal(lastPage.nextCursor, null);
    assert.equal(new Set([...firstPage.items, ...lastPage.items].map(r => r.requestId)).size, 28);
    assert.deepEqual(await listRewardClubTreasuries(renewed, 10143, null, rpc), { items: [], nextCursor: null });
    assert.equal((await listRewardClubTreasuries(other, 31337, null, rpc)).items.length, 1);
  });

  await scenario("club treasury SQL denies browser roles, limits service privileges and rejects malformed unverified candidate records without changing awards", async () => {
    const functions = await scalar(`select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,
      'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
      'service',has_function_privilege('service_role',p.oid,'execute'))) from pg_proc p where p.proname in
      ('valid_reward_club_candidate','reward_club_owner_identity','reward_club_treasury_document','service_request_reward_club_treasury',
       'service_read_reward_club_treasury','service_list_reward_club_treasuries','service_withdraw_reward_club_treasury')`);
    assert.equal(functions.length, 7); assert.ok(functions.every(f => !f.definer && !f.anon && !f.authenticated && f.service));
    for (const name of ["reward_club_treasury_requests", "reward_club_treasury_withdrawals"]) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='app_private.${name}'::regclass`), true);
      for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; select * from app_private.${name}; rollback;`));
      assert.equal(await scalar(`select has_table_privilege('service_role','app_private.${name}','UPDATE,DELETE,TRUNCATE')`), false);
    }
    const call = rpcSql("service_read_reward_club_treasury", { p_user_id: owner.userId, p_session_id: owner.sessionId, p_chain_id: 31337, p_request_id: first.requestId });
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${call} rollback;`));
    const result = JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role; ${call} rollback;`));
    assert.equal(result.requestId, first.requestId);
    const invalid = [null, {}, { ...candidate, extra: true }, { ...candidate, safeAddress: a(0) }, { ...candidate, singletonAddress: a(1) },
      { ...candidate, owners: [a(20), a(20), a(22)] }, { ...candidate, owners: [a(20), null, a(22)] }, { ...candidate, owners: [a(10), a(20), a(21)] }];
    for (const c of invalid) await assert.rejects(query(rpcSql("service_request_reward_club_treasury", { p_user_id: owner.userId, p_session_id: owner.sessionId,
      p_club_id: clubId, p_chain_id: 31337, p_candidate: c, p_idempotency_key: "invalid-club-sql" })), { code: "invalid_reward_club_treasury_request" });
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
    assert.equal(await scalar("select count(*) from app_private.reward_allocations"), 6);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
  });

  await scenario("named owner discovery excludes administrators and stale ownership and rechecks session after a real table wait", async () => {
    const own = await listRewardOwnedClubs(owner, 31337, null, rpc);
    assert.deepEqual(own, { chainId: 31337, items: [{ clubId, name: "Synthetic treasury club" }], nextCursor: null });
    assert.deepEqual((await listRewardOwnedClubs(other, 31337, null, rpc)).items, []);
    assert.deepEqual((await listRewardOwnedClubs(owner, 31337, clubId, rpc)).items, []);
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profileId)}`);
    assert.deepEqual((await listRewardOwnedClubs(owner, 31337, null, rpc)).items, []);
    assert.equal((await listRewardOwnedClubs(other, 10143, null, rpc)).items[0].clubId, clubId);
    await query(`update public.athlete_profiles set claimed_by_user_id=${literal(owner.userId)} where id=${literal(profileId)}`);
    const unlock = await lock("lock table public.clubs in access exclusive mode");
    const pending = assert.rejects(listRewardOwnedClubs(owner, 31337, null, rpc), { code: "reward_account_session_required" }); pending.catch(() => {});
    try { await waiting(1); await session(owner, true); } finally { await unlock(); } await pending; await session(owner, false);
  });
  await scenario("V3 club discovery rechecks live session after identity, allocation and receipt relation waits",async()=>{
    const read=()=>listRewardClubAllocationsV3(owner,{chainId:31337,clubId},rpc);
    assert.deepEqual((await read()).items,[]);
    for(const table of ["public.clubs","app_private.reward_allocation_recipients_v3","app_private.reward_club_payment_receipts_v3"]){
      const unlock=await lock(`lock table ${table} in access exclusive mode`);
      const pending=assert.rejects(read(),{code:"reward_account_session_required"});pending.catch(()=>{});
      try{await waiting(1);await session(owner,true);}finally{await unlock();}
      try{await pending;}finally{await session(owner,false);}
    }
    const unlock=await lock(`update public.athlete_profiles set claimed_by_user_id=${literal(other.userId)} where id=${literal(profileId)}`);
    const pending=assert.rejects(read(),{code:"reward_club_owner_required"});pending.catch(()=>{});
    try{await waiting(1);}finally{await unlock();}
    try{await pending;}finally{await query(`update public.athlete_profiles set claimed_by_user_id=${literal(owner.userId)} where id=${literal(profileId)}`);}
    const sql=rpcSql("service_list_reward_club_allocations_v3",{p_user_id:owner.userId,p_session_id:owner.sessionId,p_chain_id:31337,p_club_id:clubId,p_after_id:null});
    for(const role of ["anon","authenticated"])await assert.rejects(query(`begin;set local role ${role};${sql}rollback;`));
    const result=JSON.parse(await query(`begin;alter role service_role bypassrls;set local role service_role;${sql}rollback;`));
    assert.deepEqual(result.items,[]);assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
  });
  await scenario("service-role simulation can discover, nominate and withdraw without any committed role or award change", async () => {
    const lookup = rpcSql("service_list_reward_owned_clubs", { p_user_id: owner.userId, p_session_id: owner.sessionId, p_chain_id: 31337, p_after_id: null });
    for (const role of ["anon", "authenticated"]) await assert.rejects(query(`begin; set local role ${role}; ${lookup} rollback;`));
    assert.equal(await scalar("select prosecdef from pg_proc where oid='public.service_list_reward_owned_clubs(uuid,uuid,integer,uuid)'::regprocedure"), false);
    const nominationSql = rpcSql("service_request_reward_club_treasury", { p_user_id: owner.userId, p_session_id: owner.sessionId,
      p_club_id: clubId, p_chain_id: 31337, p_candidate: candidate, p_idempotency_key: "positive-service-role-nomination" });
    const results = (await query(`begin; alter role service_role bypassrls; set local role service_role;
      ${lookup} ${nominationSql}
      select public.service_withdraw_reward_club_treasury(${literal(owner.userId)},${literal(owner.sessionId)},31337,
        (select id from app_private.reward_club_treasury_requests where user_id=${literal(owner.userId)} and idempotency_key='positive-service-role-nomination'));
      rollback;`)).split("\n").map(s => JSON.parse(s));
    assert.equal(results[0].items[0].clubId, clubId); assert.equal(results[1].status, "pending_review");
    assert.equal(results[2].status, "withdrawn"); assert.equal(results[2].requestId, results[1].requestId);
    assert.equal(await scalar("select count(*) from app_private.reward_club_treasury_requests where idempotency_key='positive-service-role-nomination'"), 0);
    assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"), roleBefore);
    assert.equal(await scalar("select sum(amount_wei)::text from app_private.reward_entitlements"), total);
  });
}
