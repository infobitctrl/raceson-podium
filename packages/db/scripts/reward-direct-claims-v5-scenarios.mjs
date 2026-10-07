import assert from 'node:assert/strict';
import {literal as q} from './reward-integration-fixture.mjs';

// Used only after the V4 acceptance fixture in the PID-owned scratch database.
// Seed V5-shaped immutable records; this is not a contract migration or a chain
// receipt test. Actual V5 bytecode/receipt checks run in owned-chain integration.
export async function directClaimsV5Scenarios({harness,scenario}){
 const {query,scalar}=harness;
 assert.match(harness.database,/^sitrail_validation_[0-9]+$/);
 const batch='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644';
 const r=await scalar(`select to_jsonb(x) from (select r.approval_id,r.beneficiary_id,'0x'||encode(r.entitlement_id,'hex') entitlement,r.amount_wei::text,
  a.setup_id,a.launch_id,p.claimed_by_user_id user_id,s.id session_id
  from app_private.reward_sponsor_recipients_v4 r join app_private.reward_sponsor_allocation_approvals_v4 a on a.id=r.approval_id
  join app_private.reward_sponsor_uploads_v4 u on u.approval_id=a.id
  join public.athlete_profiles p on p.id=r.beneficiary_id and p.is_claimed
  join auth.sessions s on s.user_id=p.claimed_by_user_id
  where a.setup_id::text like 'af000000-%' and r.beneficiary_kind='athlete' order by r.entitlement_id limit 1)x`);
 assert.ok(r?.user_id);
 await query(`begin;set local session_replication_role=replica;
  update app_private.reward_sponsor_executions set plan=plan||jsonb_build_object('version',5,'chainId',10143,'walletRegistry','0x'||repeat('78',20),'identityIssuer','0x'||repeat('89',20)) where setup_id=${q(r.setup_id)};
  update app_private.reward_sponsor_allocation_approvals_v4 set document_text=(document_text::jsonb||'{"schema":"podium-copy-allocation-document-v1"}'::jsonb)::text where id=${q(r.approval_id)};
  update app_private.reward_sponsor_uploads_v4 set package_text=(package_text::jsonb||'{"protocolVersion":5}'::jsonb)::text where approval_id=${q(r.approval_id)};
  commit;
  insert into app_private.reward_demo_copy_batches(file_sha256,sporting_sha256,target_project_ref,source_captured_at,closed_after_round) values(${q(batch)},repeat('1',64),'niklhlmljiikwbkrmapw',now(),5);
  insert into app_private.reward_demo_copy_athletes(athlete_id,batch_sha256,ordinal,username) values(${q(r.beneficiary_id)},${q(batch)},1,'racesmon1');
  insert into app_private.reward_demo_copy_accounts(user_id,batch_sha256,kind,athlete_id) values(${q(r.user_id)},${q(batch)},'athlete',${q(r.beneficiary_id)});
  insert into app_private.reward_demo_copy_launch_sources(launch_id,batch_sha256,source_fingerprint,source_projection) values(${q(r.launch_id)},${q(batch)},repeat('1',64),'{}');
  update auth.users set raw_app_meta_data=jsonb_build_object('podium_copy_batch',${q(batch)},'podium_demo_kind','athlete','podium_demo_ordinal','1','trail_credential_mode','username') where id=${q(r.user_id)};
  update public.user_profiles set primary_athlete_profile_id=${q(r.beneficiary_id)},status='active' where user_id=${q(r.user_id)};
  insert into public.account_login_identifiers(user_id,username) values(${q(r.user_id)},'demo.athlete1') on conflict(user_id) do update set username=excluded.username;
  update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(r.session_id)};
 `);
 const read=(proof=null,receipt=null,patch={})=>{
  const a={...r,...patch};
  return scalar(`select public.service_reward_demo_copy_direct_claim_v5(${q(a.user_id)},${q(a.session_id)},${q(a.approval_id)},${q(a.entitlement)},${q(proof)},${q(receipt===null?null:JSON.stringify(receipt))}::jsonb)`);
 };
 await scenario('V5 walletless owner can read an approved award without a destination or new legacy request',async()=>{
  const count=await scalar('select count(*) from app_private.reward_sponsor_claims_v4');
  const v=await read();assert.equal(v.plan.version,5);assert.equal(v.award.entitlementId,r.entitlement);assert.equal(v.challenge,null);assert.equal(v.receipt,null);
  assert.equal(await scalar('select count(*) from app_private.reward_sponsor_claims_v4'),count);
  await assert.rejects(read(null,null,{entitlement:'0x'+'fe'.repeat(32)}),/reward_claim_scope_required/);
 });
 await scenario('V5 rechecks active session, claimed profile, server-owned alias and rejects foreign proofs',async()=>{
  await assert.rejects(read('72000000-0000-4000-8000-000000000099'),/reward_destination_proof_required/);
  await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(r.session_id)}`);
  await assert.rejects(read(),/reward_account_session_required/);
  await query(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=${q(r.session_id)};
   update public.athlete_profiles set is_claimed=false,claimed_by_user_id=null where id=${q(r.beneficiary_id)}`);
  await assert.rejects(read(),/reward_claim_scope_required/);
  await query(`update public.athlete_profiles set is_claimed=true,claimed_by_user_id=${q(r.user_id)} where id=${q(r.beneficiary_id)};
   update auth.users set raw_app_meta_data=raw_app_meta_data||'{"podium_demo_ordinal":"2"}' where id=${q(r.user_id)}`);
  await assert.rejects(read(),/reward_claim_scope_required/);
  await query(`update auth.users set raw_app_meta_data=raw_app_meta_data||'{"podium_demo_ordinal":"1"}' where id=${q(r.user_id)}`);
  assert.equal((await read()).award.entitlementId,r.entitlement);
 });
 await scenario('V5 requires a current same-session testnet proof and preserves its exact wallet',async()=>{
  const c=await scalar(`select public.service_create_reward_wallet_challenge(${q(r.user_id)},${q(r.session_id)},10143,'0x'||repeat('56',20),'https://podium.raceson.com','synthetic-v5-proof')`);
  // SQL stores a server-verified proof. Cryptographic rejection is tested by the
  // API/chain suite; these deterministic bytes are intentionally not consent.
  const proof=await scalar(`select public.service_confirm_reward_wallet_proof(${q(r.user_id)},${q(r.session_id)},${q(c.challengeId)},'0x'||repeat('12',32),'0x'||repeat('34',65))`);
  assert.equal((await read(proof.proof.proofId)).challenge.address,'0x'+'56'.repeat(20));
  await query(`begin;set local session_replication_role=replica;update app_private.reward_wallet_challenges set issued_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' where id=${q(c.challengeId)};commit;`);
  await assert.rejects(read(proof.proof.proofId),/reward_wallet_challenge_expired/);
 });
 await scenario('V5 canonical receipt journal is idempotent, amount-bound, immutable and private',async()=>{
  const receipt={transactionHash:'0x'+'ab'.repeat(32),blockHash:'0x'+'bc'.repeat(32),amountWei:r.amount_wei,recipient:'0x'+'56'.repeat(20),blockNumber:'100'};
  await assert.rejects(read(null,{...receipt,amountWei:'1'}),/invalid_sponsor_claim/);
  assert.deepEqual((await read(null,receipt)).receipt,receipt);assert.deepEqual((await read(null,receipt)).receipt,receipt);
  await assert.rejects(read(null,{...receipt,transactionHash:'0x'+'cd'.repeat(32)}),/reward_sponsor_claim_conflict/);
  assert.equal(await scalar('select count(*) from app_private.reward_direct_claim_receipts_v5'),1);
  const awards=await scalar(`select public.service_reward_demo_copy_athlete_awards(${q(r.user_id)},${q(r.session_id)},null)`);
  const row=awards.items.find(a=>a.entitlementId===r.entitlement);
  assert.equal(row.protocolVersion,5);assert.deepEqual(row.directClaim,{paid:true});assert.deepEqual(row.claims,[]);
  await assert.rejects(query('delete from app_private.reward_direct_claim_receipts_v5'),/reward_result_review_immutable/);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(`select has_table_privilege('${role}','app_private.reward_direct_claim_receipts_v5','SELECT,INSERT,UPDATE,DELETE')`),false);
  for(const role of ['anon','authenticated'])assert.equal(await scalar(`select has_function_privilege('${role}','public.service_reward_demo_copy_direct_claim_v5(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')`),false);
  assert.equal(await scalar("select has_function_privilege('service_role','public.service_reward_demo_copy_direct_claim_v5(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')"),true);
 });
 await scenario('V5 cannot create a claim request in the hosted legacy approval queue',async()=>{
  const destination=await scalar(`select id from app_private.reward_athlete_destination_requests where user_id=${q(r.user_id)} limit 1`);
  const count=await scalar('select count(*) from app_private.reward_sponsor_claims_v4');
  const body={approvalId:r.approval_id,entitlementId:r.entitlement,destinationId:destination};
  await assert.rejects(query(`select public.service_reward_demo_copy_claim(${q(r.user_id)},${q(r.session_id)},'72000000-0000-4000-8000-000000000098','recipient','request',${q(JSON.stringify(body))})`),/reward_claim_scope_required/);
  assert.equal(await scalar('select count(*) from app_private.reward_sponsor_claims_v4'),count);
 });
}
