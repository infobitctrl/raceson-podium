import assert from 'node:assert/strict';
import {literal as q} from './reward-integration-fixture.mjs';
export async function clubOwnerApprovalScenarios({harness,scenario},row){
 const {query,scalar}=harness,id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,'0')}`,address=n=>'0x'+n.repeat(40);
 const batch='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644';
 await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select v.id::uuid,v.email,'authenticated','authenticated','{}','{}',now(),now() from(values(${q(id(31))},'third-owner@example.invalid'),(${q(id(41))},'outsider@example.invalid'))v(id,email);
  insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id)
  values(${q(id(32))},'third-owner','Synthetic','Third','Third owner',1990,'active',true,${q(id(31))}),(${q(id(42))},'outsider','Synthetic','Outsider','Outsider',1990,'active',true,${q(id(41))});
  insert into public.club_memberships(id,club_id,athlete_profile_id,status) values(${q(id(33))},${q(row.beneficiary_id)},${q(id(32))},'active');`);
 for(const [i,n] of [11,21,31,41].entries())await query(`
  update public.user_profiles set status='active' where user_id=${q(id(n))};
  insert into auth.sessions(id,user_id,not_after) values(${q(id(n+1000))},${q(id(n))},clock_timestamp()+interval '1 hour');
  insert into app_private.reward_demo_copy_athletes values(${q(id(n+1))},${q(batch)},${211+i},${q('racesmon'+(211+i))});
  insert into app_private.reward_demo_copy_accounts(user_id,batch_sha256,kind,athlete_id) values(${q(id(n))},${q(batch)},'athlete',${q(id(n+1))});
  insert into public.account_login_identifiers(user_id,username) values(${q(id(n))},${q('demo.athlete'+(211+i))});`);
 const ids=[id(13),id(23),id(33)],roster=await scalar(`select public.service_reward_club_creation_members(${q(id(1))},${q(id(2))},${q(row.beneficiary_id)},null,${q('{'+ids.join(',')+'}')}::uuid[])`);
 const enriched=await scalar(`select public.service_reward_club_creation_members_v2(${q(id(1))},${q(id(2))},${q(row.beneficiary_id)},null,${q('{'+ids.join(',')+'}')}::uuid[])`);
 assert(enriched.items.every(m=>m.username?.startsWith('demo.athlete')&&m.role==='athlete'));
 assert(roster.items.every(m=>Object.keys(m).sort().join(',')==='memberId,name,userId'));
 const members=roster.items.map((m,i)=>({memberId:m.memberId,userId:m.userId,name:m.name,address:address(String(i+3))}));
 const proof=await scalar(`select proof_id::text from app_private.reward_demo_copy_club_creations where id=${q(id(5))}`);
 const create={requestId:id(100),clubId:row.beneficiary_id,proofId:proof,owners:members.map(m=>m.address).sort(),members};
 await scalar(`select public.service_reward_demo_copy_club_creation(${q(id(1))},${q(id(2))},'request',${q(JSON.stringify(create))}::jsonb)`);
 await query(`insert into app_private.reward_demo_copy_club_creation_events(request_id,kind,transaction_hash,body) values(${q(id(100))},'verified','0x'||repeat('ac',32),jsonb_build_object('safeAddress',${q(address('9'))},'transactionHash','0x'||repeat('ac',32)))`);
 const call=(n,action='read',input={})=>scalar(`select public.service_reward_club_owner_approval(${q(id(n))},${q(id(n===1?2:n+1000))},${q(id(100))},${q(row.approval_id)},${q(row.entitlement)},${q(action)},${q(JSON.stringify(input))}::jsonb)`);
 let request;
 await scenario('selected athlete accounts discover awards without gaining club manager authority',async()=>{
  for(const n of [11,21,31]){
   const page=await scalar(`select public.service_reward_club_owner_awards(${q(id(n))},${q(id(n+1000))},null)`);
   assert(page.items.some(item=>item.creationId===id(100)&&item.award.entitlementId===row.entitlement));
   await assert.rejects(scalar(`select public.service_reward_club_creation_members(${q(id(n))},${q(id(n+1000))},${q(row.beneficiary_id)},null,null)`),/reward_club_owner_required/);
  }
  assert.equal((await scalar(`select public.service_reward_club_owner_awards(${q(id(41))},${q(id(1041))},null)`)).items.length,0);
  await assert.rejects(call(41),/reward_claim_scope_required/);
  assert.equal((await call(1)).signerAddress,null);
  assert.equal((await call(11)).signerAddress,members[0].address);
 });
 await scenario('member club portal separates current membership, management and selected signing authority',async()=>{
  const read=n=>scalar(`select public.service_reward_club_memberships(${q(id(n))},${q(id(n===1?2:n+1000))},null)`);
  for(const n of [11,21,31]){const page=await read(n);const club=page.items.find(c=>c.clubId===row.beneficiary_id);assert(club);assert.equal(club.role,'member');assert.equal(club.canSign,true);}
  assert.equal((await read(1)).items.find(c=>c.clubId===row.beneficiary_id).role,'manager');
  assert.equal((await read(41)).items.length,0);
  await query(`insert into public.club_memberships(id,club_id,athlete_profile_id,status) values(${q(id(43))},${q(row.beneficiary_id)},${q(id(42))},'active')`);
  try{
   const member=(await read(41)).items.find(c=>c.clubId===row.beneficiary_id);assert.equal(member.role,'member');assert.equal(member.canSign,false);
   await assert.rejects(call(41),/reward_claim_scope_required/);
   await query(`update public.club_memberships set status='removed' where id=${q(id(43))}`);assert.equal((await read(41)).items.length,0);
   await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(id(1011))}`);await assert.rejects(read(11),/reward_account_session_required/);
  }finally{await query(`delete from public.club_memberships where id=${q(id(43))}; update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(id(1011))}`);}
  const after=await scalar(`select public.service_reward_club_memberships(${q(id(11))},${q(id(1011))},${q(row.beneficiary_id)})`);assert(after.items.every(c=>c.clubId>row.beneficiary_id));
  for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_club_memberships(uuid,uuid,uuid)','EXECUTE')`),false);
 });
 await scenario('durable approvals accept separate selected accounts and reject impersonation, stale IDs and duplicate consent',async()=>{
  const body={creationId:id(100),approvalId:row.approval_id,entitlementId:row.entitlement,safeAddress:address('9'),amountWei:row.amount_wei,owners:create.owners};
  const input={previousId:null,body,expiresAt:new Date(Date.now()+480000).toISOString()};
  await assert.rejects(call(1,'prepare',input),/reward_club_owner_required/);
  request=(await call(11,'prepare',input)).request;
  const signature='0x'+'34'.repeat(65),sign=(n,who)=>call(n,'sign',{requestId:request.requestId,address:who,signature});
  await assert.rejects(sign(21,members[0].address),/reward_club_owner_required/);
  await assert.rejects(call(11,'sign',{requestId:id(999),address:members[0].address,signature}),/reward_sponsor_claim_conflict/);
  await assert.rejects(call(31,'submitted',{requestId:request.requestId,hash:'0x'+'ab'.repeat(32)}),/reward_sponsor_claim_conflict/);
  await sign(11,members[0].address);await sign(11,members[0].address);
  assert.equal((await call(21)).request.signatures.length,1);
  await assert.rejects(call(11,'sign',{requestId:request.requestId,address:members[0].address,signature:'0x'+'56'.repeat(65)}),/reward_sponsor_claim_conflict/);
  await sign(21,members[1].address);assert.equal((await call(31)).request.signatures.length,2);
  await call(31,'submitted',{requestId:request.requestId,hash:'0x'+'ad'.repeat(32)});
  assert.equal((await call(11)).request.submissions.length,1);
  await assert.rejects(call(31,'prepare',input),/reward_sponsor_claim_conflict/);
 });
 await scenario('approval access and writes fail after member removal, identity changes or session expiry',async()=>{
  await query(`update public.club_memberships set status='removed' where id=${q(id(23))}`);
  await assert.rejects(call(11),/reward_claim_scope_required/);await assert.rejects(call(1),/reward_claim_scope_required/);
  await query(`update public.club_memberships set status='active' where id=${q(id(23))};update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(id(1011))}`);
  await assert.rejects(call(11),/reward_account_session_required/);
  await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(id(1011))};update public.athlete_profiles set is_claimed=false,claimed_by_user_id=null where id=${q(id(22))}`);
  await assert.rejects(call(31),/reward_claim_scope_required/);
  await query(`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${q(id(21))} where id=${q(id(22))};
   update app_private.reward_club_owner_approvals set created_at=clock_timestamp()-interval '9 minutes',expires_at=clock_timestamp()-interval '1 second' where id=${q(request.requestId)}`);
  await assert.rejects(call(11,'sign',{requestId:request.requestId,address:members[0].address,signature:'0x'+'34'.repeat(65)}),/reward_sponsor_claim_conflict/);
  for(const role of ['anon','authenticated']){
   assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_club_creation_members_v2(uuid,uuid,uuid,uuid,uuid[])','EXECUTE')`),false);
   assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_club_owner_approval(uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')`),false);
   assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_club_owner_awards(uuid,uuid,text)','EXECUTE')`),false);
  }
  for(const table of ['reward_demo_club_roster','reward_club_owner_approvals','reward_club_owner_signatures','reward_club_owner_submissions'])
   for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
 });
 await scenario('copied roster repair is idempotent and preserves sporting facts, managers and primary-club choices',async()=>{
  await query(`begin;
  do $test$ declare athlete uuid; before_results text; before_accounts text; before_owners text; restored integer; expected integer; begin
   select r.athlete_profile_id into athlete from public.result_rows r join public.registrations g on g.id=r.registration_id
   where r.represented_club_id is not null and r.represented_club_id=g.represented_club_id
    and not exists(select 1 from app_private.reward_demo_copy_athletes a where a.athlete_id=r.athlete_profile_id)
    and not exists(select 1 from public.clubs c where c.created_by_athlete_profile_id=r.athlete_profile_id)
   order by r.id limit 1;
   if athlete is null then raise exception 'fixture_athlete_required';end if;
   insert into app_private.reward_demo_copy_athletes values(athlete,${q(batch)},250,'racesmon250');
   insert into app_private.reward_demo_copy_results(result_id,batch_sha256,publication_id,classification_ids)
    select distinct on(r.id) r.id,${q(batch)},p.id,'{}'::uuid[] from public.result_rows r
    join public.result_publications p on p.result_run_id=r.result_run_id
    where r.athlete_profile_id=athlete order by r.id,p.id;
   -- This rollback-only synthetic fixture simulates the original missing import.
   delete from public.club_memberships where athlete_profile_id=athlete and membership_origin='represented';
   select count(distinct r.represented_club_id) into expected from public.result_rows r join public.registrations g on g.id=r.registration_id
    where r.athlete_profile_id=athlete and r.represented_club_id=g.represented_club_id
     and not exists(select 1 from public.club_memberships m where m.athlete_profile_id=athlete and m.club_id=r.represented_club_id);
   select md5(jsonb_agg(to_jsonb(r) order by id)::text) into before_results from public.result_rows r;
   select md5(jsonb_agg(to_jsonb(a) order by id)::text) into before_accounts from auth.users a;
   select md5(jsonb_agg(to_jsonb(m) order by id)::text) into before_owners from public.club_memberships m where membership_role='owner';
   restored:=app_private.repair_reward_demo_club_roster();
   if expected<1 or restored<>expected or app_private.repair_reward_demo_club_roster()<>0 then raise exception 'repair_not_idempotent';end if;
   if exists(select 1 from public.club_memberships m join app_private.reward_demo_club_roster p on p.member_id=m.id where m.is_primary or m.membership_role<>'member' or m.membership_origin<>'represented') then raise exception 'invented_roster_authority';end if;
   if before_results is distinct from(select md5(jsonb_agg(to_jsonb(r) order by id)::text) from public.result_rows r)
    or before_accounts is distinct from(select md5(jsonb_agg(to_jsonb(a) order by id)::text) from auth.users a)
    or before_owners is distinct from(select md5(jsonb_agg(to_jsonb(m) order by id)::text) from public.club_memberships m where membership_role='owner') then raise exception 'repair_changed_retained_facts';end if;
  end $test$;rollback;`);
 });

}
