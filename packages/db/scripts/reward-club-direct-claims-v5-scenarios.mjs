import assert from 'node:assert/strict';
import {literal as q} from './reward-integration-fixture.mjs';
export async function clubDirectClaimsV5Scenarios({harness,scenario}){
 const {query,scalar}=harness;assert.match(harness.database,/^sitrail_validation_[0-9]+$/);
 const id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,'0')}`,address=n=>'0x'+n.repeat(40);
 const row=await scalar(`select to_jsonb(x) from(select r.approval_id,r.beneficiary_id,'0x'||encode(r.entitlement_id,'hex') entitlement,r.amount_wei::text from app_private.reward_sponsor_recipients_v4 r join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id where e.plan->>'version'='5' and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1' and r.beneficiary_kind='club' order by r.entitlement_id limit 1)x`);
 assert.ok(row);
 // Only the upstream sporting projection is a stub in this scratch database.
 // Actual session, role, club ownership, creation provenance record, wallet proof,
 // immutable award/version, receipt and grant checks execute unchanged.
 const source=await scalar("select pg_get_functiondef('public.operator_read_reward_five_round_copy_v1(text)'::regprocedure)");
 try{
 await query(`create or replace function public.operator_read_reward_five_round_copy_v1(batch_hash text) returns jsonb language sql stable security invoker set search_path='' as $$select jsonb_build_object('clubs',jsonb_build_array(jsonb_build_object('id',${q(row.beneficiary_id)}::text)))$$;
 insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(${q(id(1))},'v5-club@example.invalid','authenticated','authenticated','{"podium_role_setup":"20261005-owner-request","trail_credential_mode":"username","podium_requested_role":"club_representative"}','{}',now(),now());
 update public.user_profiles set status='active' where user_id=${q(id(1))};
 insert into public.account_login_identifiers(user_id,username) values(${q(id(1))},'demo.club1');
 insert into auth.sessions(id,user_id,not_after) values(${q(id(2))},${q(id(1))},clock_timestamp()+interval '1 hour');
 insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id) values(${q(id(3))},'v5-club-owner','Synthetic','Club owner','Synthetic club owner',1990,'active',true,${q(id(1))});
 insert into public.clubs(id,slug,name,status) values(${q(row.beneficiary_id)},'v5-club','Synthetic V5 club','active') on conflict(id) do nothing;
 begin;set local session_replication_role=replica;update public.club_memberships set status='removed' where club_id=${q(row.beneficiary_id)} and membership_role='owner';commit;
 insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id) select ${q(id(4))},${q(row.beneficiary_id)},${q(id(3))},'active',id from public.club_roles where club_id=${q(row.beneficiary_id)} and is_owner;
 `);
 const read=(proof=null,receipt=null,creation=id(5))=>scalar(`select public.service_reward_demo_copy_club_direct_claim_v5(${q(id(1))},${q(id(2))},${q(row.approval_id)},${q(row.entitlement)},${q(creation)},${q(proof)},${q(receipt?JSON.stringify(receipt):null)}::jsonb)`);
 await scenario('V5 club requires its own verified creation and current original club authority',async()=>{
  await assert.rejects(read(),/reward_club_treasury_required/);
  const c=await scalar(`select public.service_create_reward_wallet_challenge(${q(id(1))},${q(id(2))},10143,${q(address('2'))},'https://podium.raceson.com','v5-club-proof')`);
  const proof=await scalar(`select public.service_confirm_reward_wallet_proof(${q(id(1))},${q(id(2))},${q(c.challengeId)},'0x'||repeat('12',32),'0x'||repeat('34',65))`);
  const owners=[address('2'),address('3'),address('4')];
  await query(`insert into app_private.reward_demo_copy_club_creations(id,user_id,session_id,club_id,sender,owners,owner_identity,proof_id,salt_nonce) values(${q(id(5))},${q(id(1))},${q(id(2))},${q(row.beneficiary_id)},${q(address('2'))},${q(JSON.stringify(owners))}::jsonb,app_private.reward_club_owner_identity(${q(row.beneficiary_id)},${q(id(1))}),${q(proof.proof.proofId)},'1')`);
  await assert.rejects(read(),/reward_club_treasury_required/);
  await query(`insert into app_private.reward_demo_copy_club_creation_events(request_id,kind,transaction_hash,body) values(${q(id(5))},'verified','0x'||repeat('ab',32),jsonb_build_object('safeAddress',${q(address('5'))},'transactionHash','0x'||repeat('ab',32)))`);
  const v=await read(proof.proof.proofId);assert.equal(v.award.beneficiaryKind,1);assert.equal(v.treasury.safeAddress,address('5'));assert.equal(v.challenge.address,address('2'));
  await assert.rejects(read(null,null,id(6)),/reward_club_treasury_required/);
  await assert.rejects(query(`begin;update public.athlete_profiles set is_claimed=false,claimed_by_user_id=null where id=${q(id(3))};select public.service_reward_demo_copy_club_direct_claim_v5(${q(id(1))},${q(id(2))},${q(row.approval_id)},${q(row.entitlement)},${q(id(5))},null,null);rollback;`),/reward_claim_scope_required/);
  await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(id(2))}`);await assert.rejects(read(),/reward_account_session_required/);
  await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(id(2))}`);
 });
 await scenario('V5 club rejects a foreign owner proof and records only exact treasury receipts',async()=>{
  const c=await scalar(`select public.service_create_reward_wallet_challenge(${q(id(1))},${q(id(2))},10143,${q(address('8'))},'https://podium.raceson.com','v5-club-foreign-proof')`);
  const proof=await scalar(`select public.service_confirm_reward_wallet_proof(${q(id(1))},${q(id(2))},${q(c.challengeId)},'0x'||repeat('12',32),'0x'||repeat('34',65))`);
  await assert.rejects(read(proof.proof.proofId),/reward_destination_proof_required/);
  const receipt={transactionHash:'0x'+'bc'.repeat(32),amountWei:row.amount_wei,recipient:address('5'),blockNumber:'100',blockHash:'0x'+'cd'.repeat(32)};
  await assert.rejects(read(null,{...receipt,recipient:address('8')}),/invalid_sponsor_claim/);
  assert.deepEqual((await read(null,receipt)).receipt,receipt);assert.deepEqual((await read(null,receipt)).receipt,receipt);
  await assert.rejects(read(null,{...receipt,transactionHash:'0x'+'ef'.repeat(32)}),/reward_sponsor_claim_conflict/);
  const page=await scalar(`select public.service_reward_demo_copy_club_awards(${q(id(1))},${q(id(2))},null)`),award=page.items.find(a=>a.entitlementId===row.entitlement);
  assert.equal(award.protocolVersion,5);assert.deepEqual(award.directClaim,{paid:true});assert.deepEqual(award.claims,[]);
  for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_demo_copy_club_direct_claim_v5(uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE')`),false);
 });
 await scenario('club member selection is scoped, immutable, current and private',async()=>{
  for(const n of [11,21])await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(${q(id(n))},${q('member'+n+'@example.invalid')},'authenticated','authenticated','{}','{}',now(),now());
   insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id) values(${q(id(n+1))},${q('member-'+n)},'Synthetic','Member',${q('Synthetic member '+n)},1990,'active',true,${q(id(n))});
   insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id) select ${q(id(n+2))},${q(row.beneficiary_id)},${q(id(n+1))},'active',id from public.club_roles where club_id=${q(row.beneficiary_id)} and not is_owner order by id limit 1;`);
  const ids=[id(4),id(13),id(23)],roster=()=>scalar(`select public.service_reward_club_creation_members(${q(id(1))},${q(id(2))},${q(row.beneficiary_id)},null,${q('{'+ids.join(',')+'}')}::uuid[])`);
  const members=(await roster()).items.map((m,i)=>({...m,address:address(String(i+2))}));assert.equal(members.length,3);
  const proof=await scalar(`select proof_id::text from app_private.reward_demo_copy_club_creations where id=${q(id(5))}`);
  const body={requestId:id(99),clubId:row.beneficiary_id,proofId:proof,owners:members.map(m=>m.address).sort(),members};
  const request=b=>scalar(`select public.service_reward_demo_copy_club_creation(${q(id(1))},${q(id(2))},'request',${q(JSON.stringify(b))}::jsonb)`);
  const created=await request(body);assert.equal(created.members.length,3);assert.equal(created.current,true);assert(created.members.every(m=>!('userId'in m)));
  assert.deepEqual(await request(body),created);
  await assert.rejects(request({...body,members:[{...members[0],userId:id(11)},...members.slice(1)]}),/members_changed/);
  await assert.rejects(scalar(`select public.service_reward_club_creation_members(${q(id(11))},${q(id(2))},${q(row.beneficiary_id)},null,null)`),/session_required/);
  const held=JSON.parse(await query(`begin;update public.club_memberships set status='removed' where id=${q(id(13))};select app_private.reward_demo_copy_club_creation_document(${q(id(99))},${q(id(1))});rollback;`));assert.equal(held.current,false);
  assert.equal((await request(body)).current,true);
  for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_club_creation_members(uuid,uuid,uuid,uuid,uuid[])','EXECUTE')`),false);
  assert.equal(await scalar(`select has_table_privilege('service_role','app_private.reward_club_creation_members','SELECT')`),false);
 });

 await scenario('V6 club reads immutable plans and rejects unknown versions without changing receipts',async()=>{
  const setup=await scalar(`select setup_id::text from app_private.reward_sponsor_allocation_approvals_v4 where id=${q(row.approval_id)}`);
  const change=version=>query(`begin;set local session_replication_role=replica;update app_private.reward_sponsor_executions set plan=jsonb_set(plan,'{version}',to_jsonb(${version}::integer)) where setup_id=${q(setup)};commit;`);
  try{
   await change(6);assert.equal((await read()).plan.version,6);
   const page=await scalar(`select public.service_reward_demo_copy_club_awards(${q(id(1))},${q(id(2))},null)`);
   const award=page.items.find(a=>a.entitlementId===row.entitlement);assert.equal(award.protocolVersion,6);assert.deepEqual(award.claims,[]);
   await change(7);await assert.rejects(read(),/reward_sponsor_claim_not_ready/);
  }finally{await change(5);}
 });
 }finally{await query(source);}
}
