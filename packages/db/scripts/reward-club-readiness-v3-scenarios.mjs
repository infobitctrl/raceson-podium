import assert from 'node:assert/strict';
import { requestRewardClubTreasury,withdrawRewardClubTreasury,readClubReadinessV3,recordClubReadinessV3 } from '../dist/rewards/index.js';
import { getClubReadinessV3,reviewClubReadinessV3,revokeClubTreasuryReadinessV3 } from '../../../apps/api/dist/features/rewards/club-readiness-v3-service.js';
import { clubReviewFixture } from '../../../apps/api/test/fixtures/reward-club-review.mjs';
import { literal as q } from './reward-integration-fixture.mjs';
import { clubClaimsV3Scenarios } from './reward-club-claims-v3-scenarios.mjs';
import { clubAllocationsV3Scenarios } from './reward-club-allocations-v3-scenarios.mjs';
import { organizerClubAwardsV3Scenarios } from './reward-organizer-club-awards-v3-scenarios.mjs';
const id=n=>`8f900000-0000-4000-8000-${String(n).padStart(12,'0')}`;

/** Only inside the validator's rollback transaction. Actual SQL authority,
 * source and immutability checks; deterministic Safe-reader fixture, not a
 * live treasury, real consent, saved-demo identity or payment. */
export async function clubReadinessV3Scenarios({query,rpc,scope,operatorIdentity,sourceHoldSql,expectNoClubAward=false,runtime}){
  const owner={userId:id(1),sessionId:id(2)},other={userId:id(3),sessionId:id(4)},profileId=id(5);
  const clubs=JSON.parse(await query(`select coalesce(jsonb_agg(source_beneficiary_id order by entitlement_id),'[]'::jsonb)
    from app_private.reward_allocation_recipients_v3 where approval_id=${q(scope.approvalId)} and beneficiary_kind='club';`));
  assert.equal(clubs.length===0,expectNoClubAward,'fixture club awards must match the declared test case');
  const clubId=clubs[0]??id(7);
  const balances=await query('select jsonb_build_object(\'amount\',sum(amount_wei)::text,\'count\',count(*)) from app_private.reward_allocation_recipients_v3;');
  await query(`insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (${q(owner.userId)},'club-readiness-v3@example.invalid','authenticated','authenticated','{}','{}',now(),now()),
    (${q(other.userId)},'club-readiness-other-v3@example.invalid','authenticated','authenticated','{}','{}',now(),now());
    update public.user_profiles set status='active' where user_id in(${q(owner.userId)},${q(other.userId)});
    insert into auth.sessions(id,user_id,not_after) values(${q(owner.sessionId)},${q(owner.userId)},clock_timestamp()+interval '1 hour'),
      (${q(other.sessionId)},${q(other.userId)},clock_timestamp()+interval '1 hour');
    insert into public.clubs(id,slug,name,status) values(${q(clubId)},'synthetic-club-readiness-v3','Synthetic V3 club','active') on conflict(id) do nothing;
    insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,birth_year,status,is_claimed,claimed_by_user_id)
      values(${q(profileId)},'synthetic-club-readiness-owner-v3','Synthetic','Club owner','Synthetic V3 owner',1990,'active',true,${q(owner.userId)});
    insert into public.club_memberships(id,club_id,athlete_profile_id,status,club_role_id)
      select ${q(id(6))},${q(clubId)},${q(profileId)},'active',id from public.club_roles where club_id=${q(clubId)} and is_owner;`);
  await clubAllocationsV3Scenarios({query,rpc,scope,owner,other,profileId,clubId,expectNoClubAward,sourceHoldSql});
  const fixture=clubReviewFixture(),evidence=fixture.input.evidence,deps={chainId:31337,reader:fixture.chain.reader,rpc};
  if(runtime && !expectNoClubAward){
    const {deployOriginalClubSafeFixture}=await import('../../rewards-chain/integration/safe-deployment-fixture.mjs');
    const {readVerifiedRewardClubSafeDeployment}=await import('../../rewards-chain/dist/index.js');
    const safe=await deployOriginalClubSafeFixture(runtime.chain);
    await runtime.chain.testClient.mine({blocks:96,interval:1});
    const observed=await readVerifiedRewardClubSafeDeployment(runtime.reader,safe.provenance);
    const block=b=>({number:b.number.toString(),hash:b.hash,timestamp:b.timestamp.toString()});
    evidence.candidate={safeAddress:safe.expected.context.verifyingContract.toLowerCase(),singletonAddress:safe.expected.singletonAddress.toLowerCase(),
      fallbackHandlerAddress:safe.expected.fallbackHandlerAddress.toLowerCase(),owners:safe.expected.owners.map(x=>x.toLowerCase()).sort()};
    Object.assign(evidence,{factoryAddress:safe.provenance.factoryAddress.toLowerCase(),deploymentTransactionHash:safe.deployment.transactionHash,
      deploymentBlock:block(observed.deploymentBlock),reviewedBlock:block(observed.safe.finalizedBlock),initializerHash:observed.initializerHash});
    deps.reader=runtime.reader;
  }
  const nomination=await requestRewardClubTreasury(owner,31337,{clubId,candidate:evidence.candidate,idempotencyKey:'club-readiness-v3-nomination'},rpc);
  await organizerClubAwardsV3Scenarios({query,rpc,scope,operatorIdentity,owner,nomination,clubId,expectNoClubAward,sourceHoldSql});
  const base={chainId:31337,uploadId:scope.uploadId,requestId:nomination.requestId};
  const read=(who=operatorIdentity,role='operator')=>readClubReadinessV3(who,{...base,role},rpc);
  const denied=async(code,fn)=>{await query('savepoint club_denied;');try{await assert.rejects(fn,{code});}finally{await query('rollback to savepoint club_denied;');}};
  if(expectNoClubAward){
    // The native race fixture intentionally has no represented club. A valid
    // club owner and nomination cannot manufacture an award from its reserve.
    await denied('reward_club_readiness_scope_required',()=>read());
    await denied('reward_club_readiness_scope_required',()=>read(owner,'recipient'));
    assert.equal(await query('select jsonb_build_object(\'amount\',sum(amount_wei)::text,\'count\',count(*)) from app_private.reward_allocation_recipients_v3;'),balances);
    return;
  }
  const first=await read();assert.equal(first.state,'unreviewed');assert.equal(first.source.current,true);assert.equal(first.source.slot,scope.slot);
  assert.deepEqual((await read(owner,'recipient')).source,first.source);
  await denied('reward_club_readiness_scope_required',()=>read(other,'recipient'));
  await denied('reward_club_readiness_scope_required',()=>read(owner,'operator'));
  await denied('reward_club_readiness_scope_required',()=>readClubReadinessV3(operatorIdentity,{...base,chainId:10143,role:'operator'},rpc));
  const input={...base,reviewId:id(10),previousReviewId:null,sourceGuardHash:first.source.sourceGuardHash,identityFingerprint:first.identityFingerprint,evidence};
  await denied('reward_club_readiness_identity_changed',()=>reviewClubReadinessV3(operatorIdentity,{...input,identityFingerprint:'0'.repeat(64)},deps));
  const saved=await reviewClubReadinessV3(operatorIdentity,input,deps);
  assert.deepEqual(await reviewClubReadinessV3(operatorIdentity,input,{...deps,reader:undefined}),saved);
  assert.equal((await read()).state,'reviewed');assert.equal((await read(owner,'recipient')).state,'reviewed');
  if(runtime) await clubClaimsV3Scenarios({query,rpc,base,scope,owner,other,profileId,operatorIdentity,input,deps,runtime,sourceHoldSql});
  const visible=await getClubReadinessV3(owner,{...base,role:'recipient'},deps);
  assert.doesNotMatch(JSON.stringify(visible),/owners|session|EvidenceRef|signature|privateKey|evidence|consent/);
  await denied('reward_club_readiness_revision_changed',()=>reviewClubReadinessV3(operatorIdentity,{...input,reviewId:id(11)},deps));
  await denied('reward_ledger_idempotency_conflict',()=>reviewClubReadinessV3(operatorIdentity,{...input,evidence:{...evidence,authorityEvidenceRef:id(90)}},deps));
  await query(`savepoint source_drift;${sourceHoldSql??`update app_private.reward_planning_drafts set revision=revision+1 where id=${q(scope.draftId)};`}`);
  assert.equal((await read()).state,'source_hold');
  await denied('reward_club_readiness_hold',()=>reviewClubReadinessV3(operatorIdentity,{...input,reviewId:id(11),previousReviewId:id(10)},deps));
  assert.deepEqual(await reviewClubReadinessV3(operatorIdentity,input,{...deps,reader:undefined}),saved);
  await query('rollback to savepoint source_drift;');
  await query(`savepoint identity_drift;update public.user_profiles set locale=case when locale='hr' then 'en' else 'hr' end where user_id=${q(owner.userId)};`);
  assert.equal((await read()).state,'identity_changed');
  await denied('reward_club_readiness_identity_changed',()=>recordClubReadinessV3(operatorIdentity,{...input,reviewId:id(11),previousReviewId:id(10)},rpc));
  await query('rollback to savepoint identity_drift;');
  await query(`savepoint ownership_drift;update public.athlete_profiles set claimed_by_user_id=${q(other.userId)} where id=${q(profileId)};`);
  assert.equal((await read()).state,'identity_hold');await denied('reward_club_readiness_scope_required',()=>read(owner,'recipient'));
  await query('rollback to savepoint ownership_drift;');
  await query(`savepoint session_drift;update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(owner.sessionId)};`);
  await denied('reward_account_session_required',()=>read(owner,'recipient'));await query('rollback to savepoint session_drift;');
  const revoke={...base,reviewId:saved.reviewId,reason:'operator_correction'};
  const revoked=await revokeClubTreasuryReadinessV3(operatorIdentity,revoke,deps);
  assert.equal((await read()).state,'revoked');assert.deepEqual(await revokeClubTreasuryReadinessV3(operatorIdentity,revoke,deps),revoked);
  assert.equal((await reviewClubReadinessV3(operatorIdentity,input,{...deps,reader:undefined})).revokedAt,revoked.revokedAt);
  const next={...input,reviewId:id(11),previousReviewId:id(10)};
  await reviewClubReadinessV3(operatorIdentity,next,deps);assert.equal((await read()).state,'reviewed');
  await revokeClubTreasuryReadinessV3(operatorIdentity,revoke,deps);assert.equal((await read()).state,'reviewed');
  // Recheck after asynchronous chain evidence, not only before it.
  await query('savepoint late_change;');let changed=false;
  const changing={...deps.reader,getChainId:async()=>{if(!changed){changed=true;await query(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(operatorIdentity.sessionId)};`);}return 31337;}};
  await denied('reward_account_session_required',()=>reviewClubReadinessV3(operatorIdentity,{...next,reviewId:id(12),previousReviewId:id(11)},{...deps,reader:changing}));
  await query('rollback to savepoint late_change;');
  assert.equal((await read()).review.id,id(11));
  await withdrawRewardClubTreasury(owner,31337,nomination.requestId,rpc);assert.equal((await read()).state,'request_withdrawn');
  for(const role of ['anon','authenticated']){
    for(const signature of ['service_read_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,text,uuid)',
      'service_record_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,uuid,text,text,jsonb)',
      'service_revoke_reward_club_readiness_v3(uuid,uuid,integer,uuid,uuid,uuid,text)'])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_function_privilege('${role}','public.${signature}','EXECUTE'));`)),false);
    for(const table of ['reward_club_readiness_v3','reward_club_readiness_revocations_v3'])
      assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('${role}','app_private.${table}','SELECT,INSERT,UPDATE,DELETE'));`)),false);
  }
  for(const table of ['reward_club_readiness_v3','reward_club_readiness_revocations_v3']){
    assert.equal(JSON.parse(await query(`select to_jsonb(relrowsecurity) from pg_class where oid='app_private.${table}'::regclass;`)),true);
    assert.equal(JSON.parse(await query(`select to_jsonb(has_table_privilege('service_role','app_private.${table}','UPDATE,DELETE'));`)),false);
    await denied('reward_ledger_is_immutable',()=>query(`delete from app_private.${table};`));
  }
  assert.equal(await query('select jsonb_build_object(\'amount\',sum(amount_wei)::text,\'count\',count(*)) from app_private.reward_allocation_recipients_v3;'),balances);
}
