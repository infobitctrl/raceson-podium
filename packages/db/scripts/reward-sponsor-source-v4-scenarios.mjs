import assert from 'node:assert/strict';
import {resolveSponsorSourceV4,rewardFinaleBindingV3,readRewardSourceMappingV2,saveRewardSourceMappingV2,rewardDistributionSetups,rewardSponsorLaunch} from '../dist/rewards/index.js';
import {createDefaultRewardProgrammeDraftV2} from '../../domain/dist/rewards/programme-draft-v2.js';
import {createGuidedSetup,bindGuidedSeason,addGuidedGroup} from '../../domain/dist/rewards/guided-setup-editor.js';
import {SPONSOR_CATEGORY_PRESETS} from '../../domain/dist/rewards/sponsor-source.js';
import {publishedSnapshot,publishedMapping} from '../../../apps/api/test/fixtures/published-reward-v2.mjs';
import {integrationFixtureSql,literal as q} from './reward-integration-fixture.mjs';
const id=n=>`8f240924-0000-4000-8000-${String(n).padStart(12,'0')}`;

export async function sponsorSourceV4Scenarios({harness,scenario}){
 const {query,scalar,rpc}=harness;
 await query(integrationFixtureSql().replaceAll('78000000-','8f240924-').replaceAll('reward-integration','sponsor-source-integration')
   .replaceAll('Synthetic','Sponsor source synthetic')
   .replaceAll('reward-operator@example.invalid','source-owner@example.invalid').replaceAll('reward-successor@example.invalid','source-sponsor@example.invalid'));
 const owner={userId:id(4),sessionId:id(8001)},sponsor={userId:id(5),sessionId:id(8002)},draftId=id(8003),editionId=id(8004),raceId=id(8005),bindingId=id(8006);
 const snapshot=publishedSnapshot(),club=snapshot.catalogue.categories[1];
 const categories=[snapshot.catalogue.categories[0],...Array.from({length:6},(_,i)=>({...snapshot.catalogue.categories[0],id:id(9000+i),name:`Synthetic category ${i}`})),club];
 categories[0].eligibility={gender:'F',privateExtra:'DO_NOT_RETURN'};snapshot.catalogue.categories=categories;
 const presets=Object.fromEntries(SPONSOR_CATEGORY_PRESETS.map((key,index)=>[key,categories[index].id]));
 await query(`delete from public.organization_memberships where id=${q(id(9))};
   insert into auth.sessions(id,user_id,not_after) values(${q(owner.sessionId)},${q(owner.userId)},clock_timestamp()+interval '1 hour'),(${q(sponsor.sessionId)},${q(sponsor.userId)},clock_timestamp()+interval '1 hour');
   insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
   values(${q(draftId)},${q(id(1))},${q(id(3))},31337,${q(JSON.stringify(createDefaultRewardProgrammeDraftV2()))}::jsonb,${q(owner.userId)});
   insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload) values(${q(id(3))},${q(id(1))},${q(JSON.stringify(snapshot))}::jsonb);
   insert into public.event_editions(id,event_series_id,slug,name,start_date,status) values(${q(editionId)},${q(id(11))},'source-pending-finale','Synthetic pending finale','2026-10-04','draft');
   insert into public.event_categories(id,event_edition_id,slug,name,distance_km,status) values(${q(raceId)},${q(editionId)},'source-short','Synthetic short',5,'draft');`);
 const finale=await rewardFinaleBindingV3(owner,31337,draftId,undefined,rpc);
 await rewardFinaleBindingV3(owner,31337,draftId,{requestId:bindingId,expectedBindingId:null,contextHash:finale.contextHash,editionId,races:[{competitionId:categories[0].competitionId,raceId}]},rpc);
 let workspace=await readRewardSourceMappingV2(owner,31337,draftId,rpc);
 const mapping=publishedMapping();mapping.rounds[4].roundId=bindingId;
 workspace=await saveRewardSourceMappingV2(owner,31337,workspace,workspace.revision,workspace.rulesRevision,workspace.catalogueHash,mapping,rpc);
 const eventMappings=workspace.catalogue.rounds.map(round=>({sourceEventEditionId:round.slot===5?id(8100):round.editionId,editionId:round.editionId}));
 const selection={sourceLeagueId:snapshot.sourceLeagueId,sourceSeasonId:snapshot.sourceSeasonId,eventEditionId:null};
 const read=(request=selection,actor=sponsor,chainId=31337)=>resolveSponsorSourceV4(actor,chainId,request,rpc);
 await scenario('unpublished event selection saves and reloads for its owner without source authority',async()=>{
   let seq=9600;const configuration={...createGuidedSetup(()=>id(seq++)),budgetMon:'100',sponsorSelection:{...selection,eventEditionId:id(8100)}};
   const setupId=id(8300),request={requestId:id(8301),expectedRevision:0,configuration};
   const saved=await rewardDistributionSetups(sponsor,31337,setupId,request,rpc);
   assert.deepEqual(saved.configuration,configuration);
   assert.deepEqual((await rewardDistributionSetups(sponsor,31337,setupId,undefined,rpc)).configuration,configuration);
   assert.equal((await rewardDistributionSetups(sponsor,31337,setupId,request,rpc)).revision,1);
   await assert.rejects(rewardDistributionSetups(owner,31337,setupId,undefined,rpc),{code:'reward_setup_not_found'});
   await assert.rejects(read(configuration.sponsorSelection),{code:'reward_sponsor_source_not_found'});
   assert.equal(saved.configuration.context,null);
   const trackConfiguration={...configuration,sponsorSelection:{...configuration.sponsorSelection,raceId}};
   const trackSaved=await rewardDistributionSetups(sponsor,31337,setupId,{requestId:id(8302),expectedRevision:1,configuration:trackConfiguration},rpc);
   assert.equal(trackSaved.revision,2);
   assert.deepEqual(trackSaved.configuration,trackConfiguration);
   assert.deepEqual((await rewardDistributionSetups(sponsor,31337,setupId,undefined,rpc)).configuration,trackConfiguration);
   assert.equal(trackSaved.configuration.context,null);
   for(const bad of [null,{}, {...configuration.sponsorSelection,eventEditionId:4},{...configuration.sponsorSelection,sourceSeasonId:'00000000-0000-0000-0000-000000000000'},{...configuration.sponsorSelection,extra:true},
    {...configuration.sponsorSelection,raceId:null},{...configuration.sponsorSelection,raceId:'bad'},{...configuration.sponsorSelection,raceId:'00000000-0000-0000-0000-000000000000'},
    {...configuration.sponsorSelection,eventEditionId:null,raceId}]){
     await assert.rejects(query(`select app_private.validate_reward_setup_configuration(${q(JSON.stringify({...configuration,sponsorSelection:bad}))}::jsonb)`),/invalid_reward_setup/);
   }
 });
 await scenario('sponsor source discovery exposes only explicitly published catalogues to a non-organizer',async()=>{
   assert.equal(await scalar(`select app_private.reward_planning_authorized(${q(sponsor.userId)},${q(id(1))})`),false);
   await assert.rejects(read(),{code:'reward_sponsor_source_not_found'});
   await query(`insert into app_private.reward_sponsor_sources_v4(chain_id,source_league_id,source_season_id,draft_id,catalogue_hash,display_name,event_mappings,category_presets,published_by_user_id)
    values(31337,${q(snapshot.sourceLeagueId)},${q(snapshot.sourceSeasonId)},${q(draftId)},${q(workspace.catalogueHash)},'Published synthetic source',${q(JSON.stringify(eventMappings))}::jsonb,${q(JSON.stringify(presets))}::jsonb,${q(owner.userId)});`);
   const view=await read();assert.equal(view.context.draftId,draftId);assert.equal(view.catalogue.rounds.length,5);
   const roleBefore=await scalar("select rolbypassrls from pg_roles where rolname='service_role'");
   const serviceView=JSON.parse(await query(`begin; alter role service_role bypassrls; set local role service_role;
     ${harness.rpcSql('service_resolve_reward_sponsor_source_v4',{p_actor_user_id:sponsor.userId,p_actor_session_id:sponsor.sessionId,p_chain_id:31337,
       p_source_league_id:selection.sourceLeagueId,p_source_season_id:selection.sourceSeasonId,p_event_edition_id:null,p_setup_id:null})} rollback;`));
   assert.equal(serviceView.context.draftId,draftId);
   assert.equal(await scalar("select rolbypassrls from pg_roles where rolname='service_role'"),roleBefore);
   assert.doesNotMatch(JSON.stringify(view),/DO_NOT_RETURN|athleteName|rulesRevision|ownerId|userId|decisions|snapshot/);
   const selected=await read({...selection,eventEditionId:id(8100)});assert.equal(selected.selectedSlot,5);assert.equal(selected.selectedRoundId,bindingId);
   await assert.rejects(read({...selection,eventEditionId:id(999999)}),{code:'reward_sponsor_source_not_found'});
   await assert.rejects(read(selection,sponsor,10143),{code:'reward_sponsor_source_not_found'});
 });
 await scenario('reopened source resolution is limited to the sponsors own active setup and exact pinned hash',async()=>{
   const view=await read();let seq=9500;
   const configuration=bindGuidedSeason(createGuidedSetup(()=>id(seq++)),view.context,view.catalogue);
   const setupId=id(8200);
   await rewardDistributionSetups(sponsor,31337,setupId,{requestId:id(8201),expectedRevision:0,configuration},rpc);
   assert.equal((await read({setupId})).context.draftId,draftId);
   await assert.rejects(read({setupId},owner),{code:'reward_sponsor_source_not_found'});
   const stale={...configuration,context:{...configuration.context,catalogueHash:'e'.repeat(64)}};
   await rewardDistributionSetups(sponsor,31337,setupId,{requestId:id(8202),expectedRevision:1,configuration:stale},rpc);
   await assert.rejects(read({setupId}),{code:'reward_sponsor_source_stale'});
   await query(`update app_private.reward_distribution_setups set archived_at=clock_timestamp() where id=${q(setupId)};`);
   await assert.rejects(read({setupId}),{code:'reward_sponsor_source_not_found'});
 });
 await scenario('track launch resolves published sporting scope for an ordinary sponsor and rejects foreign categories before writes',async()=>{
   const view=await read({...selection,eventEditionId:id(8100)});let seq=9700;const next=()=>id(seq++);
   let configuration=bindGuidedSeason(createGuidedSetup(next),view.context,view.catalogue);
   configuration.sponsorSelection={...selection,eventEditionId:id(8100),raceId};
   configuration.root.children.forEach((p,i)=>p.shareBps=i===5?10000:0);
   configuration=addGuidedGroup(configuration,configuration.guided.pots[5].nodeId,'athlete_standings',next,view.catalogue.categories[0]);
   configuration.root.children[5].children[0].shareBps=10000;
   for(const kind of ['foreign_track','foreign_category','valid']){
     const candidate=structuredClone(configuration),setupId=next();
     if(kind==='foreign_track')candidate.sponsorSelection.raceId=id(999999);
     if(kind==='foreign_category')candidate.root.children[5].children[0].rule.source.categoryId=club.id;
     await rewardDistributionSetups(sponsor,31337,setupId,{requestId:next(),expectedRevision:0,configuration:candidate},rpc);
     const prepare=()=>rewardSponsorLaunch(sponsor,31337,setupId,{requestId:next(),expectedRevision:1},rpc);
     if(kind==='valid')assert.equal((await prepare()).launch.state,'prepared');
     else {await assert.rejects(prepare,{code:'reward_launch_sources_required'});assert.equal(await scalar(`select count(*) from app_private.reward_sponsor_launches where setup_id=${q(setupId)}`),0);}
   }
 });
 await scenario('unpublished, stale, archived and expired sessions cannot resolve a source',async()=>{
   await query(`update app_private.reward_sponsor_sources_v4 set enabled=false where draft_id=${q(draftId)};`);
   await assert.rejects(read(),{code:'reward_sponsor_source_not_found'});
   await query(`update app_private.reward_sponsor_sources_v4 set enabled=true,catalogue_hash=repeat('e',64) where draft_id=${q(draftId)};`);
   await assert.rejects(read(),{code:'reward_sponsor_source_stale'});
   await query(`update app_private.reward_sponsor_sources_v4 set catalogue_hash=${q(workspace.catalogueHash)} where draft_id=${q(draftId)};
     update public.leagues set status='archived' where id=${q(id(2))};`);
   await assert.rejects(read(),{code:'reward_sponsor_source_not_found'});
   await query(`update public.leagues set status='active' where id=${q(id(2))};update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${q(sponsor.sessionId)};`);
   await assert.rejects(read(),{code:'reward_account_session_required'});
   for(const role of ['anon','authenticated']){
     assert.equal(await scalar(`select has_table_privilege('${role}','app_private.reward_sponsor_sources_v4','select,insert,update,delete')`),false);
     assert.equal(await scalar(`select has_function_privilege('${role}','public.service_resolve_reward_sponsor_source_v4(uuid,uuid,integer,uuid,uuid,uuid,uuid)','execute')`),false);
   }
   assert.equal(await scalar("select has_table_privilege('service_role','app_private.reward_sponsor_sources_v4','insert,update,delete')"),false);
 });
}
