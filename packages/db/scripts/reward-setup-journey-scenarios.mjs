import assert from 'node:assert/strict';
import {openRewardTestDatabase} from './reward-test-database.mjs';
import {integrationFixtureSql,literal} from './reward-integration-fixture.mjs';
import {rewardId as id,calculationFixture} from '../../../apps/api/test/fixtures/reward-calculation.mjs';
import {rewardSetupEvents,rewardDistributionSetups} from '../dist/rewards/index.js';
import {createRewardSetup,defaultRewardSetupPolicy,finishRewardSetup} from '../../domain/dist/rewards/distribution-setup.js';
import {generateEventTree} from '../../domain/dist/rewards/setup-event.js';
const db=openRewardTestDatabase(process.argv.slice(2));
try{
 await db.query(integrationFixtureSql());
 const owner={userId:id(4),sessionId:id(810001)},other={userId:id(5),sessionId:id(810002)};
 await db.query(`insert into auth.sessions(id,user_id,not_after) values (${literal(owner.sessionId)},${literal(owner.userId)},now()+interval '1 hour'),(${literal(other.sessionId)},${literal(other.userId)},now()+interval '1 hour');`);
 const round=calculationFixture('league').configuration.rounds[0],edition=round.eventEditionId,race=round.races[0].id;
 // Detach this synthetic event from its synthetic season: the new path must need no league.
 await db.query(`delete from public.league_round_race_mappings where league_round_event_id=${literal(round.id)};delete from public.league_round_events where id=${literal(round.id)};
 update public.event_categories set ranking_config_json='{"overall":{"enabled":true},"sex":{"enabled":false},"age":{"enabled":false},"team":{"enabled":false}}',allowed_genders='{F,M,U}',minimum_age=null,maximum_age=null where id=${literal(race)};`);
 const events=await rewardSetupEvents(owner,null,null,db.rpc);assert.ok(events.some(e=>e.id===edition));
 const catalogue=await rewardSetupEvents(owner,edition,null,db.rpc);assert.equal(catalogue.id,edition);assert.ok(catalogue.races.find(r=>r.id===race).groups.some(g=>g.key==='overall'));
 const results=await rewardSetupEvents(owner,edition,race,db.rpc);assert.equal(results.publicationState,'official');assert.equal(results.groups[0].issue,null);assert.ok(results.groups[0].candidates.length>0);
 let seq=820000;const generated=generateEventTree(createRewardSetup(id(819999)).root,catalogue,[{raceId:race,groupKey:'overall',winners:3,approved:true}],()=>id(seq++));
 const ready=finishRewardSetup({...createRewardSetup(id(819999)),version:4,programmeKind:'event',context:null,stage:'draft',policy:defaultRewardSetupPolicy(),...generated});
 const request={requestId:id(830001),expectedRevision:0,configuration:ready},saved=await rewardDistributionSetups(owner,31337,id(830000),request,db.rpc);assert.equal(saved.configuration.stage,'ready');
 for(const field of ['programmeKind','stage']){const bad={...ready,[field]:null};await assert.rejects(()=>db.rpc('service_reward_distribution_setups',{p_actor_user_id:owner.userId,p_actor_session_id:owner.sessionId,p_chain_id:31337,p_programme_id:id(830004),p_request_id:id(830005),p_expected_revision:0,p_configuration:bad}).then(r=>{if(r.error)throw Error(r.error.message);}),/invalid_reward_setup/);}
 assert.deepEqual(await rewardDistributionSetups(owner,31337,id(830000),request,db.rpc),saved);
 const revised=await rewardDistributionSetups(owner,31337,id(830000),{requestId:id(830002),expectedRevision:1,configuration:{...ready,stage:'draft',name:'Revised synthetic setup'}},db.rpc);assert.equal(revised.revision,2);
 assert.equal(await db.scalar(`select count(*) from app_private.reward_setup_revisions where setup_id=${literal(id(830000))}`),2);
 assert.equal(await db.scalar(`select configuration->>'stage' from app_private.reward_setup_revisions where setup_id=${literal(id(830000))} and revision=1`),'ready');
 await assert.rejects(()=>rewardDistributionSetups(other,31337,id(830000),undefined,db.rpc));
 await db.query(`update public.organization_memberships set status='removed' where user_id=${literal(other.userId)} and organization_id=${literal(id(1))};`);
 await assert.rejects(()=>rewardSetupEvents(other,edition,null,db.rpc),{code:'reward_setup_not_found'});
 await assert.rejects(()=>rewardSetupEvents({...owner,sessionId:other.sessionId},edition,null,db.rpc),{code:'reward_account_session_required'});
 assert.equal(await db.scalar("select has_function_privilege('authenticated','public.service_reward_setup_events(uuid,uuid,uuid,uuid)','execute')"),false);
 assert.equal(await db.scalar("select has_table_privilege('service_role','app_private.reward_setup_revisions','update')"),false);
 console.log('Reward setup journey acceptance: standalone catalogue, official results, private revisions, exact retries, cross-owner isolation and revoked sessions passed.');
}finally{await db.close();}
